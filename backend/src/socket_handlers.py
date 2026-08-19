"""Socket.IO event wiring.

Node's version tracked each connection's room token in a per-connection
closure variable. python-socketio's handlers are global functions keyed by
event name, not per-connection closures, so the same job falls to
sio.save_session(sid, ...)/get_session(sid) instead -- the `sid` is the
direct equivalent of Node's `socket.id`.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import Any, Awaitable, Callable

import socketio

import game_db
from game.roles import GameError
from rooms import Room, RoomManager

logger = logging.getLogger("avalon.socket")

RoomHandler = Callable[[Room, Any, dict[str, Any]], Awaitable[None]]


def _player_room(token: str) -> str:
    """The Socket.IO room a player's connection(s) live in, keyed by their
    stable token rather than their (ephemeral, per-connection) sid."""
    return f"player:{token}"


def _client_ip(environ: dict[str, Any]) -> str:
    """The real client IP for a Socket.IO connect, for logging/fail2ban.

    NOT environ["REMOTE_ADDR"] -- engineio's own ASGI environ translation
    (engineio/async_drivers/asgi.py:translate_request) hardcodes that to
    the literal string "127.0.0.1" and never once reads scope["client"],
    so it's always wrong here regardless of what actually connected.
    uvicorn's ProxyHeadersMiddleware (see main.py's forwarded_allow_ips)
    still does its job correctly -- it just does it by rewriting the ASGI
    scope, which engineio ignores for REMOTE_ADDR but does stash verbatim
    at environ["asgi.scope"]. Read the real, already-proxy-resolved client
    from there instead.
    """
    client = (environ.get("asgi.scope") or {}).get("client")
    return (client[0] if client else None) or "unknown"


def _error_message(err: Exception) -> str:
    if isinstance(err, GameError):
        return str(err)
    # Errors raised from Postgres stored procedures (RAISE EXCEPTION)
    # surface here as asyncpg exceptions carrying the raised text in
    # `.message`; that's already a clean, user-facing message.
    message = getattr(err, "message", None)
    if isinstance(message, str) and message:
        return message
    if str(err):
        return str(err)
    return "Something went wrong on the server."


def create_socket_server(room_manager: RoomManager) -> tuple[socketio.AsyncServer, Callable[[Room], Awaitable[None]]]:
    """Returns (sio, broadcast_room) -- main.py's pg_notify bridge needs the
    latter directly, to push state outside of a socket-event request cycle
    (i.e. when a stored procedure was called by hand from psql rather than
    through the app)."""
    sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

    # Several things can trigger a broadcast for the same room in quick
    # succession -- e.g. three players submitting mission cards within
    # milliseconds of each other fires a direct post-mutation broadcast per
    # handler PLUS a pg_notify-triggered one for each underlying DB change.
    # Each broadcast reads fresh state with its own round-trip of SELECTs,
    # so nothing stops two of them from being in flight at once and
    # completing (and therefore emitting to clients) out of order -- a
    # slower broadcast for an earlier mutation finishing after a faster one
    # for a later mutation would overwrite clients' state with stale data.
    # A per-room asyncio.Lock (FIFO-fair, same guarantee as the JS promise
    # chain it replaces) forces every broadcast for a room to run one at a
    # time, in call order, so each one is guaranteed to read state at least
    # as fresh as the one before it and always emits after it.
    broadcast_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def do_broadcast(room: Room) -> None:
        async def send_to(player) -> None:
            try:
                state = await room.serialize_for_token(player.token)
                # Targeting the player's own named Socket.IO room (joined in
                # handle_room_create/join/rejoin below) rather than their raw
                # sid: room membership is maintained by the library itself
                # and automatically drops a sid the instant it disconnects,
                # so this can never end up misdirected at a stale/reused
                # connection the way threading a captured sid string through
                # our own Player object over time could.
                await sio.emit("room:state", state, room=_player_room(player.token))
            except Exception:
                logger.exception("[socket] failed to build state for %s", player.display_name)

        await asyncio.gather(*(send_to(p) for p in room.players.values()))

    async def broadcast_room(room: Room) -> None:
        async with broadcast_locks[room.code]:
            await do_broadcast(room)

    def _log_if_unexpected(err: Exception, context: str) -> None:
        # GameError and DB-raised errors are expected, user-facing outcomes
        # (bad input, wrong phase, ...) -- anything else is a real bug and
        # worth the full traceback, not just the toast text.
        if not isinstance(err, GameError) and not getattr(err, "message", None):
            logger.exception("[socket] unexpected error (%s)", context, exc_info=err)

    async def fail(sid: str, err: Exception) -> None:
        _log_if_unexpected(err, "generic")
        await sio.emit("error", {"message": _error_message(err)}, to=sid)

    async def current_token(sid: str) -> str | None:
        session = await sio.get_session(sid)
        return session.get("token") if session else None

    async def current_ip(sid: str) -> str:
        session = await sio.get_session(sid)
        return (session.get("ip") if session else None) or "unknown"

    @sio.event
    async def connect(sid: str, environ: dict[str, Any]) -> None:
        # Stashed in the session now because environ is only available on
        # this event; handlers below read it back via current_ip(sid).
        async with sio.session(sid) as session:
            session["ip"] = _client_ip(environ)

    def with_room(handler: RoomHandler):
        async def wrapped(sid: str, data: dict[str, Any] | None = None) -> None:
            try:
                token = await current_token(sid)
                if not token:
                    raise GameError("You are not in a room.")
                found = room_manager.find_by_token(token)
                if found is None:
                    raise GameError("Room no longer exists.")
                room, player = found
                await handler(room, player, data or {})
            except Exception as err:  # noqa: BLE001 - surfaced to the player as a toast
                await fail(sid, err)

        return wrapped

    async def handle_room_create(sid: str, data: dict[str, Any] | None = None) -> None:
        data = data or {}
        try:
            display_name = str(data.get("displayName") or "").strip()
            if not display_name:
                raise GameError("Enter a display name.")
            room, player = room_manager.create_room(display_name)
            player.connected = True
            player.socket_id = sid
            player.ip = await current_ip(sid)
            async with sio.session(sid) as session:
                session["token"] = player.token
            await sio.enter_room(sid, _player_room(player.token))
            await sio.emit("room:joined", {"token": player.token, "code": room.code}, to=sid)
            await broadcast_room(room)
            # Room codes are short enough (5 chars, ~39M combinations) that
            # this is obscurity, not a security boundary -- there's nothing
            # in-app throttling a scripted client hammering room creation or
            # room:join with guessed codes. This line (and the failed-join
            # one below) exists so an external tool like fail2ban can do
            # that throttling instead, from wherever these logs end up.
            logger.info("[socket] room:create ip=%s code=%s", player.ip, room.code)
        except Exception as err:  # noqa: BLE001
            await fail(sid, err)

    async def handle_room_join(sid: str, data: dict[str, Any] | None = None) -> None:
        data = data or {}
        try:
            display_name = str(data.get("displayName") or "").strip()
            code = str(data.get("code") or "").strip()
            if not display_name:
                raise GameError("Enter a display name.")
            if not code:
                raise GameError("Enter a room code.")
            try:
                room, player = room_manager.join_room(code, display_name)
            except GameError:
                # The specific case fail2ban actually cares about: repeated
                # wrong-code guesses are indistinguishable from any other
                # socket traffic at the nginx-access-log level, since
                # Socket.IO multiplexes every event over the same long-lived
                # connection/endpoint -- this is the only layer that can see
                # "this particular attempt named a room that doesn't exist."
                logger.warning("[socket] failed room:join ip=%s code=%s", await current_ip(sid), code)
                raise
            player.connected = True
            player.socket_id = sid
            player.ip = await current_ip(sid)
            async with sio.session(sid) as session:
                session["token"] = player.token
            await sio.enter_room(sid, _player_room(player.token))
            await sio.emit("room:joined", {"token": player.token, "code": room.code}, to=sid)
            await broadcast_room(room)
        except Exception as err:  # noqa: BLE001
            await fail(sid, err)

    async def handle_room_rejoin(sid: str, data: dict[str, Any] | None = None) -> None:
        data = data or {}
        try:
            token = str(data.get("token") or "")
            found = room_manager.find_by_token(token)
            if found is None:
                raise GameError("That session is no longer valid.")
            room, player = found
            player.connected = True
            player.socket_id = sid
            player.ip = await current_ip(sid)
            async with sio.session(sid) as session:
                session["token"] = token
            await sio.enter_room(sid, _player_room(token))
            await sio.emit("room:joined", {"token": token, "code": room.code}, to=sid)
            await broadcast_room(room)
        except Exception as err:  # noqa: BLE001
            # Deliberately not the generic fail()/'error' path every other
            # handler uses: a failed rejoin means the client is still
            # showing a stale, frozen room (chat, roster, everything) for a
            # session that no longer exists server-side -- most commonly
            # because the host kicked this player while they were
            # disconnected. A toast alone would leave that stale UI on
            # screen with no visible explanation why nothing works anymore;
            # this dedicated event tells the frontend to reset to the Home
            # screen instead, carrying the reason along to show there.
            _log_if_unexpected(err, "room:rejoin")
            await sio.emit("room:rejoinFailed", {"message": _error_message(err)}, to=sid)

    async def handle_update_settings(room: Room, player, data: dict[str, Any]) -> None:
        room.update_settings(player.token, data.get("settings") or {})
        await broadcast_room(room)

    async def handle_set_role_preference(room: Room, player, data: dict[str, Any]) -> None:
        room.set_role_preference(player.token, data.get("key"), bool(data.get("want")))
        await broadcast_room(room)

    async def handle_transfer_host(room: Room, player, data: dict[str, Any]) -> None:
        room.transfer_host(player.token, int(data.get("targetSeat")))
        await broadcast_room(room)

    async def handle_room_start(room: Room, player, _data: dict[str, Any]) -> None:
        game_id = await room.start_game(player.token)
        room_manager.register_game(game_id, room.code)
        await broadcast_room(room)

    async def handle_reset_to_lobby(room: Room, player, _data: dict[str, Any]) -> None:
        room.reset_to_lobby(player.token)
        await broadcast_room(room)

    async def handle_room_leave(room: Room, player, _data: dict[str, Any]) -> None:
        room_manager.leave_room(player.token)
        await broadcast_room(room)

    async def handle_kick_player(room: Room, player, data: dict[str, Any]) -> None:
        kicked_sid, kicked = room.kick_player(player.token, int(data.get("targetSeat")))
        # room.kick_player only removes the seat from the Room itself --
        # RoomManager's separate token -> room-code map is its own state,
        # so it's this handler's job to drop the stale entry, the same way
        # RoomManager.leave_room already does for a normal Leave.
        room_manager.token_to_code.pop(kicked.token, None)
        # A kick is one host's subjective call, not inherently an abuse
        # signal on its own (could be a griefer, could just be an AFK
        # teammate) -- but logged with an IP, a jail can still watch for
        # the pattern that *is* a real signal: the same IP getting kicked
        # from several different rooms, not just once.
        logger.warning(
            "[socket] kicked ip=%s code=%s target=%s by=%s", kicked.ip, room.code, kicked.display_name, player.display_name
        )
        await broadcast_room(room)
        if kicked_sid:
            # Tell them directly, while the connection still exists to tell
            # them on -- sio.disconnect() below is a *server*-initiated
            # disconnect, and by Socket.IO's own protocol, a client never
            # auto-reconnects after one of those (unlike a plain network
            # drop, which it does retry). That's deliberate upstream
            # behavior for exactly this kind of case, not a bug to work
            # around, but it does mean the usual reconnect -> room:rejoin
            # path (see handle_room_rejoin's room:rejoinFailed, which still
            # covers a kick that lands while already disconnected) never
            # gets a chance to run for a kicked player who was live when it
            # happened -- nothing will ever trigger it. This is the only
            # way they find out at all in that case.
            await sio.emit("room:kicked", {"message": "You were removed from the room by the host."}, to=kicked_sid)
            # Force the live connection closed rather than waiting for it to
            # notice on its own -- otherwise a kicked-but-still-connected
            # player just sits in a lobby that no longer includes them until
            # they happen to take some action.
            await sio.disconnect(kicked_sid)

    async def handle_propose_team(room: Room, player, data: dict[str, Any]) -> None:
        seats_raw = data.get("seats")
        seats = [int(s) for s in seats_raw] if isinstance(seats_raw, list) else []
        excalibur_seat_raw = data.get("excaliburSeat")
        excalibur_seat = int(excalibur_seat_raw) if excalibur_seat_raw is not None else None
        await game_db.propose_team(room.game_id, player.seat_index, seats, excalibur_seat)
        await broadcast_room(room)  # NOTIFY will also fire; this just keeps the actor's own UI snappy

    async def handle_submit_team_vote(room: Room, player, data: dict[str, Any]) -> None:
        await game_db.cast_team_vote(room.game_id, player.seat_index, bool(data.get("approve")))
        await broadcast_room(room)

    async def handle_force_resolve_team_vote(room: Room, player, _data: dict[str, Any]) -> None:
        if player.token != room.host_token:
            raise GameError("Only the host can force-resolve a stuck vote.")
        disconnected_seats = [p.seat_index for p in room.players.values() if not p.connected]
        await game_db.force_resolve_team_vote(room.game_id, disconnected_seats)
        room.add_chat_message(
            player.display_name,
            "⚡ Force-resolved the stuck vote — anyone still missing a vote was counted as Approve.",
            system=True,
        )
        await broadcast_room(room)

    async def handle_force_advance_leader(room: Room, player, _data: dict[str, Any]) -> None:
        # Host-only, same as every other force-resolve. Unlike the vote/
        # mission cases there's no "who's still missing" set to gather --
        # sp_force_advance_leader only cares whether a team's already been
        # proposed this turn (checked there), not which seat is currently
        # connected, so the frontend is the only place that gates this on
        # the leader actually being offline.
        if player.token != room.host_token:
            raise GameError("Only the host can force-advance a stuck leader.")
        await game_db.force_advance_leader(room.game_id)
        room.add_chat_message(
            player.display_name,
            "⚡ Force-advanced the stuck leader — the team-building turn passed to the next player.",
            system=True,
        )
        await broadcast_room(room)

    async def handle_submit_mission_vote(room: Room, player, data: dict[str, Any]) -> None:
        await game_db.cast_mission_vote(
            room.game_id, player.seat_index, bool(data.get("success")), bool(data.get("reverse"))
        )
        await broadcast_room(room)

    async def handle_force_resolve_mission(room: Room, player, _data: dict[str, Any]) -> None:
        # Host-only, and the actual eligibility check (seat is on the
        # current team, hasn't already played) happens in
        # sp_force_resolve_mission itself -- this only needs to gather who's
        # disconnected right now, since Postgres has no idea about socket
        # connection state.
        if player.token != room.host_token:
            raise GameError("Only the host can force-resolve a stuck mission.")
        disconnected_seats = [p.seat_index for p in room.players.values() if not p.connected]
        await game_db.force_resolve_mission(room.game_id, disconnected_seats)
        room.add_chat_message(
            player.display_name,
            "⚡ Force-resolved the stuck quest — anyone still missing a card was auto-played as Success"
            " (or Fail, if they're Agravain).",
            system=True,
        )
        await broadcast_room(room)

    async def handle_reveal_arthur(room: Room, player, _data: dict[str, Any]) -> None:
        await game_db.reveal_arthur(room.game_id, player.seat_index)
        await broadcast_room(room)

    async def handle_excalibur_view(room: Room, player, data: dict[str, Any]) -> None:
        await game_db.excalibur_view(room.game_id, player.seat_index, int(data.get("targetSeat")))
        await broadcast_room(room)

    async def handle_excalibur_decision(room: Room, player, data: dict[str, Any]) -> None:
        new_success_raw = data.get("newSuccess")
        new_success = bool(new_success_raw) if new_success_raw is not None else None
        await game_db.excalibur_decision(room.game_id, player.seat_index, bool(data.get("use")), new_success)
        await broadcast_room(room)

    async def handle_force_decline_excalibur(room: Room, player, _data: dict[str, Any]) -> None:
        # No connection check needed here beyond host-gating -- unlike the
        # mission/vote force-resolves, the frontend already knows whether
        # the holder is disconnected (excaliburHolderSeat is public) and
        # only shows this button then; nothing here depends on which seats
        # are currently connected.
        if player.token != room.host_token:
            raise GameError("Only the host can force-resolve a stuck Excalibur decision.")
        await game_db.force_decline_excalibur(room.game_id)
        room.add_chat_message(
            player.display_name,
            "⚡ Force-resolved Excalibur — declined on the holder's behalf, nobody's card was swapped.",
            system=True,
        )
        await broadcast_room(room)

    async def handle_use_lady_of_lake(room: Room, player, data: dict[str, Any]) -> None:
        await game_db.use_lady_of_lake(room.game_id, player.seat_index, int(data.get("targetSeat")))
        await broadcast_room(room)

    async def handle_force_resolve_lady_of_lake(room: Room, player, data: dict[str, Any]) -> None:
        if player.token != room.host_token:
            raise GameError("Only the host can force-resolve a stuck Lady of the Lake.")
        target_seat = int(data.get("targetSeat"))
        await game_db.force_resolve_lady_of_lake(room.game_id, target_seat)
        target = next((p for p in room.players.values() if p.seat_index == target_seat), None)
        target_name = target.display_name if target else f"seat {target_seat}"
        room.add_chat_message(
            player.display_name,
            f"⚡ Force-resolved the Lady of the Lake — passed it to {target_name} on the holder's behalf.",
            system=True,
        )
        await broadcast_room(room)

    async def handle_submit_assassination(room: Room, player, data: dict[str, Any]) -> None:
        targets_raw = data.get("targetSeats")
        targets = [int(s) for s in targets_raw] if isinstance(targets_raw, list) else []
        await game_db.submit_assassination(room.game_id, player.seat_index, targets)
        await broadcast_room(room)

    async def handle_force_pass_assassination(room: Room, player, _data: dict[str, Any]) -> None:
        if player.token != room.host_token:
            raise GameError("Only the host can force-pass a stuck assassination.")
        await game_db.force_pass_assassination(room.game_id)
        room.add_chat_message(
            player.display_name,
            "⚡ Force-resolved the assassination as a Pass — Good's win stands.",
            system=True,
        )
        await broadcast_room(room)

    async def handle_chat_send(room: Room, player, data: dict[str, Any]) -> None:
        if player.muted:
            raise GameError("You have been muted by the host.")
        room.check_chat_rate_limit(player.token)
        message = str(data.get("message") or "").strip()
        if not message:
            return
        room.add_chat_message(player.display_name, message)
        await broadcast_room(room)

    async def handle_set_muted(room: Room, player, data: dict[str, Any]) -> None:
        muted = bool(data.get("muted"))
        target = room.set_muted(player.token, int(data.get("targetSeat")), muted)
        # Same reasoning as the kick log line: one mute isn't necessarily
        # abuse (could be a legitimate moderation call for an argumentative
        # but otherwise fine player), but the same IP getting muted
        # repeatedly across different rooms is a real pattern to watch for.
        # Logs unmutes too (action=unmuted), purely for a complete audit
        # trail -- nothing is expected to alert on that half.
        logger.warning(
            "[socket] %s ip=%s code=%s target=%s by=%s",
            "muted" if muted else "unmuted",
            target.ip,
            room.code,
            target.display_name,
            player.display_name,
        )
        await broadcast_room(room)

    @sio.event
    async def disconnect(sid: str) -> None:
        token = await current_token(sid)
        if not token:
            return
        found = room_manager.find_by_token(token)
        if found is None:
            return
        room, _player = found
        if room.phase == "lobby":
            # In the lobby, a disconnect is treated as leaving outright so
            # seats don't pile up with ghosts before a game has even started.
            room_manager.leave_room(token)
        else:
            room.mark_disconnected(token)
        await broadcast_room(room)

    sio.on("room:create", handle_room_create)
    sio.on("room:join", handle_room_join)
    sio.on("room:rejoin", handle_room_rejoin)
    sio.on("room:updateSettings", with_room(handle_update_settings))
    sio.on("room:setRolePreference", with_room(handle_set_role_preference))
    sio.on("room:transferHost", with_room(handle_transfer_host))
    sio.on("room:start", with_room(handle_room_start))
    sio.on("room:resetToLobby", with_room(handle_reset_to_lobby))
    sio.on("room:leave", with_room(handle_room_leave))
    sio.on("room:kickPlayer", with_room(handle_kick_player))
    sio.on("game:proposeTeam", with_room(handle_propose_team))
    sio.on("game:forceAdvanceLeader", with_room(handle_force_advance_leader))
    sio.on("game:submitTeamVote", with_room(handle_submit_team_vote))
    sio.on("game:forceResolveTeamVote", with_room(handle_force_resolve_team_vote))
    sio.on("game:submitMissionVote", with_room(handle_submit_mission_vote))
    sio.on("game:forceResolveMission", with_room(handle_force_resolve_mission))
    sio.on("game:revealArthur", with_room(handle_reveal_arthur))
    sio.on("game:excaliburView", with_room(handle_excalibur_view))
    sio.on("game:excaliburDecision", with_room(handle_excalibur_decision))
    sio.on("game:forceDeclineExcalibur", with_room(handle_force_decline_excalibur))
    sio.on("game:useLadyOfLake", with_room(handle_use_lady_of_lake))
    sio.on("game:forceResolveLadyOfLake", with_room(handle_force_resolve_lady_of_lake))
    sio.on("game:submitAssassination", with_room(handle_submit_assassination))
    sio.on("game:forcePassAssassination", with_room(handle_force_pass_assassination))
    sio.on("chat:send", with_room(handle_chat_send))
    sio.on("room:setMuted", with_room(handle_set_muted))

    return sio, broadcast_room
