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

# Every settings key a player can cast a lobby preference vote on. The vote
# is purely advisory -- see Room.serialize_for_token -- the host's own
# toggle is what actually gets used when the game starts.
VOTABLE_KEYS = [
    "merlin", "percival", "morgana", "mordred", "oberon", "assassin", "agravain", "arthur", "tristanIseult",
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

    @property
    def player_list(self) -> list[Player]:
        return sorted(self.players.values(), key=lambda p: p.seat_index)

    def add_player(self, display_name: str, *, as_host: bool = False) -> Player:
        if self.phase != "lobby":
            raise GameError("This game has already started.")
        if len(self.players) >= MAX_PLAYERS:
            raise GameError(f"Room is full (max {MAX_PLAYERS} players).")

        token = str(uuid.uuid4())
        player = Player(
            token=token,
            seat_index=self.next_seat_index,
            display_name=display_name[:30],
            is_host=as_host,
        )
        self.next_seat_index += 1
        self.players[token] = player
        if as_host:
            self.host_token = token
        return player

    def remove_player(self, token: str) -> None:
        if self.phase == "lobby":
            was_host = self.host_token == token
            removed = self.players.pop(token, None)
            if removed is not None:
                for voters in self.role_preferences.values():
                    voters.discard(removed.seat_index)
            if was_host and self.players:
                nxt = self.player_list[0]
                nxt.is_host = True
                self.host_token = nxt.token
        else:
            player = self.players.get(token)
            if player is not None:
                player.connected = False

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

    def add_chat_message(self, display_name: str, message: str) -> dict[str, Any]:
        entry = {
            "displayName": display_name,
            "message": str(message)[:500],
            "at": int(time.time() * 1000),
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
                {"seat": seat, "displayName": player.display_name, "isHost": player.is_host, "token": player.token}
                if player
                else None
            ),
            "players": [
                {"seat": p.seat_index, "displayName": p.display_name, "isHost": p.is_host, "connected": p.connected}
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
