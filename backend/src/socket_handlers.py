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

    async def fail(sid: str, err: Exception) -> None:
        if not isinstance(err, GameError) and not getattr(err, "message", None):
            logger.exception("[socket] unexpected error", exc_info=err)
        await sio.emit("error", {"message": _error_message(err)}, to=sid)

    async def current_token(sid: str) -> str | None:
        session = await sio.get_session(sid)
        return session.get("token") if session else None

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
            await sio.save_session(sid, {"token": player.token})
            await sio.enter_room(sid, _player_room(player.token))
            await sio.emit("room:joined", {"token": player.token, "code": room.code}, to=sid)
            await broadcast_room(room)
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
            room, player = room_manager.join_room(code, display_name)
            player.connected = True
            player.socket_id = sid
            await sio.save_session(sid, {"token": player.token})
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
            await sio.save_session(sid, {"token": token})
            await sio.enter_room(sid, _player_room(token))
            await sio.emit("room:joined", {"token": token, "code": room.code}, to=sid)
            await broadcast_room(room)
        except Exception as err:  # noqa: BLE001
            await fail(sid, err)

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

    async def handle_submit_mission_vote(room: Room, player, data: dict[str, Any]) -> None:
        await game_db.cast_mission_vote(
            room.game_id, player.seat_index, bool(data.get("success")), bool(data.get("reverse"))
        )
        await broadcast_room(room)

    async def handle_reveal_arthur(room: Room, player, _data: dict[str, Any]) -> None:
        await game_db.reveal_arthur(room.game_id, player.seat_index)
        await broadcast_room(room)

    async def handle_excalibur_decision(room: Room, player, data: dict[str, Any]) -> None:
        target_seat_raw = data.get("targetSeat")
        target_seat = int(target_seat_raw) if target_seat_raw is not None else None
        new_success_raw = data.get("newSuccess")
        new_success = bool(new_success_raw) if new_success_raw is not None else None
        await game_db.excalibur_decision(room.game_id, player.seat_index, bool(data.get("use")), target_seat, new_success)
        await broadcast_room(room)

    async def handle_use_lady_of_lake(room: Room, player, data: dict[str, Any]) -> None:
        await game_db.use_lady_of_lake(room.game_id, player.seat_index, int(data.get("targetSeat")))
        await broadcast_room(room)

    async def handle_submit_assassination(room: Room, player, data: dict[str, Any]) -> None:
        await game_db.submit_assassination(room.game_id, player.seat_index, int(data.get("targetSeat")))
        await broadcast_room(room)

    async def handle_chat_send(room: Room, player, data: dict[str, Any]) -> None:
        message = str(data.get("message") or "").strip()
        if not message:
            return
        room.add_chat_message(player.display_name, message)
        await broadcast_room(room)

    @sio.event
    async def disconnect(sid: str) -> None:
        token = await current_token(sid)
        if not token:
            return
        found = room_manager.find_by_token(token)
        if found is None:
            return
        room, player = found
        player.connected = False
        player.socket_id = None
        if room.phase == "lobby":
            # In the lobby, a disconnect is treated as leaving outright so
            # seats don't pile up with ghosts before a game has even started.
            room_manager.leave_room(token)
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
    sio.on("game:proposeTeam", with_room(handle_propose_team))
    sio.on("game:submitTeamVote", with_room(handle_submit_team_vote))
    sio.on("game:submitMissionVote", with_room(handle_submit_mission_vote))
    sio.on("game:revealArthur", with_room(handle_reveal_arthur))
    sio.on("game:excaliburDecision", with_room(handle_excalibur_decision))
    sio.on("game:useLadyOfLake", with_room(handle_use_lady_of_lake))
    sio.on("game:submitAssassination", with_room(handle_submit_assassination))
    sio.on("chat:send", with_room(handle_chat_send))

    return sio, broadcast_room
