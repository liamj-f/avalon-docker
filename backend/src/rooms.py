"""In-memory lobby manager: players, chat, host, the role preference poll.

This deliberately stays in memory rather than in Postgres -- it's inherently
tied to live socket connections, which don't have a clean row-per-fact
shape, and doesn't need to survive a restart the way an in-progress vote
does. Once a game starts, live state moves into Postgres (see game_db.py);
Room just tracks which `games.id` a room's game currently is.
"""

from __future__ import annotations

import random
import time
import uuid
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import game_db
from game.config import MAX_PLAYERS, MIN_PLAYERS
from game.roles import GameError, assign_roles, compute_knowledge, default_settings, validate_settings
from room_code import generate_unique_code

MAX_CHAT_HISTORY = 200
# chat:send only ever capped message *length* (500 chars, client-side) --
# nothing stopped a scripted client from sending as fast as the socket would
# take them. 5 messages per 10 seconds is generous for an actual human
# typing at the table, but blocks a flood outright.
CHAT_RATE_WINDOW_SECONDS = 10.0
CHAT_RATE_MAX_MESSAGES = 5

# Every settings key a player can cast a lobby preference vote on. The vote
# is purely advisory -- see Room.serialize_for_token -- the host's own
# toggle is what actually gets used when the game starts.
VOTABLE_KEYS = [
    "merlin", "percival", "morgana", "mordred", "oberon", "assassin", "agravain", "arthur", "gawain", "tristanIseult",
    "lancelot", "lancelotPair", "guinevere", "ladyOfLake", "excalibur",
]


@dataclass
class Player:
    token: str
    seat_index: int
    display_name: str
    socket_id: str | None = None
    connected: bool = False
    is_host: bool = False
    # Host-only moderation tool for once the game has started, when
    # kick_player is no longer available (see there) -- silences chat
    # without touching the seat/role a dealt game depends on.
    muted: bool = False


class Room:
    def __init__(self, code: str) -> None:
        self.code = code
        self.players: dict[str, Player] = {}  # token -> Player
        self.next_seat_index = 0
        self.settings: dict[str, bool] = default_settings()
        # Host-only lobby display preference, entirely separate from
        # `settings` above (which is real game config, validated at start
        # and dealt from) -- purely controls whether non-host players see
        # the host's live toggle choices in serialize_for_token, and only
        # while still in the lobby (see there). Persists across a
        # reset_to_lobby by design -- it's the host's standing preference,
        # not a per-game setting.
        self.hide_role_selections: bool = False
        self.role_preferences: dict[str, set[int]] = {}  # role key -> set of seats who want it
        self.phase = "lobby"  # 'lobby' | 'in_game'
        self.game_id: UUID | None = None
        self.chat: list[dict[str, Any]] = []
        self.host_token: str | None = None
        self.created_at = time.time()
        self._chat_send_times: dict[str, list[float]] = {}  # token -> recent chat:send timestamps

    @property
    def player_list(self) -> list[Player]:
        return sorted(self.players.values(), key=lambda p: p.seat_index)

    def add_player(self, display_name: str, *, as_host: bool = False) -> Player:
        if self.phase != "lobby":
            raise GameError("This game has already started.")
        if len(self.players) >= MAX_PLAYERS:
            raise GameError(f"Room is full (max {MAX_PLAYERS} players).")

        display_name = display_name[:30]
        # Case/whitespace-insensitive -- "Alice" and " alice " are the same
        # collision as far as anyone reading seat labels, chat, or the vote
        # history is concerned, all of which key purely off this string with
        # no seat number attached to disambiguate.
        if any(p.display_name.strip().casefold() == display_name.strip().casefold() for p in self.players.values()):
            raise GameError(f'"{display_name}" is already taken in this room -- pick a different name.')

        token = str(uuid.uuid4())
        player = Player(
            token=token,
            seat_index=self.next_seat_index,
            display_name=display_name,
            is_host=as_host,
        )
        self.next_seat_index += 1
        self.players[token] = player
        if as_host:
            self.host_token = token
        return player

    def _next_host_candidate(self, exclude_token: str) -> Player | None:
        """Picks who host should move to when it has to move automatically
        (as opposed to the host deliberately choosing someone via
        transfer_host). Prefers a connected, unmuted seat -- a muted player
        made host this way would be stuck (set_muted refuses to let a host
        act on their own seat, in either direction) -- but falls back to
        just "anyone connected", and finally to anyone left at all, rather
        than leaving the room hostless."""
        candidates = [p for p in self.player_list if p.token != exclude_token]
        if not candidates:
            return None
        connected = [p for p in candidates if p.connected]
        pool = connected or candidates
        return next((p for p in pool if not p.muted), pool[0])

    def remove_player(self, token: str) -> None:
        if self.phase == "lobby":
            was_host = self.host_token == token
            removed = self.players.pop(token, None)
            if removed is not None:
                for voters in self.role_preferences.values():
                    voters.discard(removed.seat_index)
            if was_host and self.players:
                nxt = self._next_host_candidate(token)
                if nxt is not None:
                    nxt.is_host = True
                    self.host_token = nxt.token
        else:
            player = self.players.get(token)
            if player is not None:
                player.connected = False

    def mark_disconnected(self, token: str) -> None:
        """Mid-game counterpart to remove_player's lobby branch: called on a
        raw socket disconnect once a game is underway, where (unlike the
        lobby) the seat itself never goes away -- see remove_player. But if
        the disconnecting player happens to be the host, host authority
        would otherwise be stuck on a seat nobody can reach, taking every
        host-only action down with it -- including the force-resolve escape
        hatches that exist specifically to recover from a disconnect. Hands
        it to another connected seat instead, same non-muted preference as
        remove_player's lobby-phase reassignment."""
        player = self.players.get(token)
        if player is None:
            return
        player.connected = False
        player.socket_id = None

        if self.phase == "in_game" and self.host_token == token:
            nxt = self._next_host_candidate(token)
            if nxt is not None:
                player.is_host = False
                nxt.is_host = True
                self.host_token = nxt.token

    def kick_player(self, token: str, target_seat: int) -> str | None:
        """Host-only removal of another player, lobby-only. Once a game has
        started, a seat can't be un-dealt without unraveling the whole
        game -- roles, knowledge, and vote history are all keyed off it --
        so this deliberately stops working the instant start_game succeeds.
        The host's mid-game moderation tool is set_muted instead, which
        doesn't touch the seat at all. Returns the target's current
        socket_id (if connected) so the caller can force-disconnect that
        live connection immediately, rather than leaving them sitting in a
        lobby that no longer includes them until they next take some
        action."""
        if token != self.host_token:
            raise GameError("Only the host can remove a player.")
        if self.phase != "lobby":
            raise GameError("Players can only be removed before the game starts -- mute them in chat instead.")
        target = next((p for p in self.player_list if p.seat_index == target_seat), None)
        if target is None:
            raise GameError("That player is not in this room.")
        if target.token == token:
            raise GameError("You can't remove yourself -- use Leave instead.")

        sid = target.socket_id
        self.remove_player(target.token)
        return sid

    def set_muted(self, token: str, target_seat: int, muted: bool) -> None:
        """Host-only chat moderation. Available in any phase -- Chat.jsx
        renders in both the lobby and mid-game, and mute state persists
        across a game starting/ending (it lives on the Player, not reset by
        reset_to_lobby) -- unlike kick_player, which is lobby-only."""
        if token != self.host_token:
            raise GameError("Only the host can mute a player.")
        target = next((p for p in self.player_list if p.seat_index == target_seat), None)
        if target is None:
            raise GameError("That player is not in this room.")
        if target.token == token:
            raise GameError("You can't mute yourself.")
        target.muted = muted

    def is_empty(self) -> bool:
        if not self.players:
            return True
        return all(not p.connected for p in self.players.values())

    def update_settings(self, token: str, settings: dict[str, bool]) -> None:
        if self.phase != "lobby":
            raise GameError("Cannot change roles once the game has started.")
        if token != self.host_token:
            raise GameError("Only the host can change role settings.")
        incoming = dict(settings)
        if "hideRoleSelections" in incoming:
            self.hide_role_selections = bool(incoming.pop("hideRoleSelections"))
        if incoming:
            self.settings = {**self.settings, **incoming}

    def set_role_preference(self, token: str, key: str, want: bool) -> None:
        """Non-binding preference poll: any player can say which roles they'd like to see."""
        if self.phase != "lobby":
            raise GameError("Voting is only available in the lobby.")
        if key not in VOTABLE_KEYS:
            raise GameError("Unknown role.")
        player = self.players.get(token)
        if player is None:
            raise GameError("You are not in this room.")
        voters = self.role_preferences.setdefault(key, set())
        if want:
            voters.add(player.seat_index)
        else:
            voters.discard(player.seat_index)

    def transfer_host(self, token: str, target_seat: int) -> None:
        if self.phase != "lobby":
            raise GameError("Cannot transfer host once the game has started.")
        if token != self.host_token:
            raise GameError("Only the current host can transfer host.")
        target = next((p for p in self.player_list if p.seat_index == target_seat), None)
        if target is None:
            raise GameError("That player is not in this room.")
        if target.token == token:
            return
        current = self.players.get(token)
        if current is not None:
            current.is_host = False
        target.is_host = True
        self.host_token = target.token

    def validate_start(self, token: str) -> None:
        if token != self.host_token:
            raise GameError("Only the host can start the game.")
        if self.phase != "lobby":
            raise GameError("Game already in progress.")
        count = len(self.players)
        if count < MIN_PLAYERS:
            raise GameError(f"Need at least {MIN_PLAYERS} players to start (have {count}).")
        if count > MAX_PLAYERS:
            raise GameError(f"Too many players (max {MAX_PLAYERS}).")
        errors = validate_settings(count, self.settings)
        if errors:
            raise GameError(" ".join(errors))

    async def start_game(self, token: str) -> UUID:
        self.validate_start(token)

        seats = [p.seat_index for p in self.player_list]
        assignments = assign_roles(seats, self.settings)
        knowledge = compute_knowledge(assignments)
        display_names = {p.seat_index: p.display_name for p in self.player_list}

        leader_seat = random.choice(seats)

        # Lady of the Lake can start with anyone (that's the real rule --
        # even Evil can hold and use it). Excalibur has no starting holder
        # at all -- each quest's leader assigns it fresh, to someone else on
        # that quest's team, as part of proposing it (sp_propose_team).
        lady_holder_seat = random.choice(seats) if self.settings.get("ladyOfLake") else None

        # Paired Lancelots: the mission at which they swap allegiance is
        # chosen once here, secretly, and never revealed to anyone -- see
        # _resolve_mission in the stored procedures.
        swap_mission_number = random.randrange(5) if self.settings.get("lancelotPair") else None

        players = [
            {
                "seat": a.seat,
                "displayName": display_names[a.seat],
                "roleId": a.role_id,
                "team": a.team,
                "knowledge": knowledge.get(a.seat, []),
            }
            for a in assignments
        ]

        self.game_id = await game_db.start_game(
            room_code=self.code,
            settings=self.settings,
            seat_order=seats,
            leader_seat=leader_seat,
            lady_holder_seat=lady_holder_seat,
            excalibur_holder_seat=None,  # no starting holder anymore -- see the comment above
            swap_mission_number=swap_mission_number,
            players=players,
        )
        self.phase = "in_game"
        return self.game_id

    def reset_to_lobby(self, token: str) -> UUID | None:
        """Returns the lobby back to a fresh state, keeping the same players/room. The finished game's row stays in Postgres for history."""
        if token != self.host_token:
            raise GameError("Only the host can return to the lobby.")
        finished_game_id = self.game_id
        self.phase = "lobby"
        self.game_id = None
        return finished_game_id

    def check_chat_rate_limit(self, token: str) -> None:
        """Raises if this player has already sent CHAT_RATE_MAX_MESSAGES
        within the last CHAT_RATE_WINDOW_SECONDS. Call before add_chat_message
        -- this only tracks attempts, not successes, so it also throttles a
        client hammering chat:send with blank/whitespace-only messages that
        add_chat_message would otherwise silently no-op on."""
        now = time.time()
        cutoff = now - CHAT_RATE_WINDOW_SECONDS
        recent = [t for t in self._chat_send_times.get(token, []) if t > cutoff]
        if len(recent) >= CHAT_RATE_MAX_MESSAGES:
            raise GameError("You're sending messages too fast — slow down a little.")
        recent.append(now)
        self._chat_send_times[token] = recent

    def add_chat_message(self, display_name: str, message: str, *, system: bool = False) -> dict[str, Any]:
        """system=True marks a message as generated by the server rather
        than typed by `display_name` -- used for the force-resolve
        transparency notices below, so the whole table sees when and how
        the host used one of the escape hatches, not just the host. The
        frontend renders these distinctly; `display_name` is still the
        acting host's name so the notice reads as attributed, not
        anonymous."""
        entry = {
            "displayName": display_name,
            "message": str(message)[:500],
            "at": int(time.time() * 1000),
            "system": system,
        }
        self.chat.append(entry)
        if len(self.chat) > MAX_CHAT_HISTORY:
            self.chat.pop(0)
        return entry

    async def serialize_for_token(self, token: str | None) -> dict[str, Any]:
        player = self.players.get(token) if token else None
        seat = player.seat_index if player else None

        role_preference_tally = {}
        for key in VOTABLE_KEYS:
            voters = self.role_preferences.get(key)
            role_preference_tally[key] = {
                "count": len(voters) if voters else 0,
                "you": bool(voters and seat is not None and seat in voters),
            }

        game_state = None
        if self.phase == "in_game" and self.game_id is not None:
            game_state = await game_db.load_game_state_for_seat(self.game_id, seat)
            if game_state is not None and game_state.get("phase") == "assassination":
                # The Assassin's identity is secret -- unlike the Excalibur
                # or Lady of the Lake holder (both public tokens, so the
                # frontend can already check their connection status
                # itself), so this is computed here instead of just sending
                # the seat: a plain boolean can't leak who it is, only
                # whether the host's force-pass affordance should show.
                assassin_seat = await game_db.get_assassin_seat(self.game_id)
                assassin = next((p for p in self.player_list if p.seat_index == assassin_seat), None)
                game_state["assassinDisconnected"] = bool(assassin and not assassin.connected)

        # Hiding is a lobby-only display preference (see hide_role_selections
        # above) -- once a game has actually started, the character roster
        # is table-common-knowledge in Avalon (only who holds which role is
        # secret), so this never applies to `game_state` and always shows
        # the real settings there regardless.
        is_host_view = bool(player and player.is_host)
        hide_from_this_viewer = self.hide_role_selections and self.phase == "lobby" and not is_host_view
        visible_settings = {key: False for key in self.settings} if hide_from_this_viewer else self.settings

        return {
            "code": self.code,
            "phase": self.phase,
            "settings": visible_settings,
            "rolesHidden": self.hide_role_selections,
            "rolePreferenceTally": role_preference_tally,
            "you": (
                {
                    "seat": seat,
                    "displayName": player.display_name,
                    "isHost": player.is_host,
                    "token": player.token,
                    "muted": player.muted,
                }
                if player
                else None
            ),
            "players": [
                {
                    "seat": p.seat_index,
                    "displayName": p.display_name,
                    "isHost": p.is_host,
                    "connected": p.connected,
                    "muted": p.muted,
                }
                for p in self.player_list
            ],
            "chat": self.chat,
            "game": game_state,
            "minPlayers": MIN_PLAYERS,
            "maxPlayers": MAX_PLAYERS,
        }


class RoomManager:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}  # code -> Room
        self.token_to_code: dict[str, str] = {}  # token -> room code
        self.game_id_to_code: dict[UUID, str] = {}  # Postgres games.id -> room code, for the NOTIFY listener

    def create_room(self, display_name: str) -> tuple[Room, Player]:
        code = generate_unique_code(set(self.rooms.keys()))
        room = Room(code)
        player = room.add_player(display_name, as_host=True)
        self.rooms[code] = room
        self.token_to_code[player.token] = code
        return room, player

    def join_room(self, code: str, display_name: str) -> tuple[Room, Player]:
        room = self.rooms.get(code.upper())
        if room is None:
            raise GameError("Room not found. Check the code and try again.")
        player = room.add_player(display_name)
        self.token_to_code[player.token] = room.code
        return room, player

    def find_by_token(self, token: str) -> tuple[Room, Player] | None:
        code = self.token_to_code.get(token)
        if code is None:
            return None
        room = self.rooms.get(code)
        if room is None:
            return None
        player = room.players.get(token)
        if player is None:
            return None
        return room, player

    def find_room_by_game_id(self, game_id: UUID) -> Room | None:
        code = self.game_id_to_code.get(game_id)
        return self.rooms.get(code) if code else None

    def register_game(self, game_id: UUID, room_code: str) -> None:
        self.game_id_to_code[game_id] = room_code

    def leave_room(self, token: str) -> None:
        found = self.find_by_token(token)
        if found is None:
            return
        room, _player = found
        room.remove_player(token)
        self.token_to_code.pop(token, None)
        if room.is_empty():
            self.rooms.pop(room.code, None)

    def reap_empty_rooms(self, max_age_seconds: float = 60 * 60 * 6) -> None:
        now = time.time()
        for code, room in list(self.rooms.items()):
            if room.is_empty() and (now - room.created_at) > max_age_seconds:
                self.rooms.pop(code, None)
