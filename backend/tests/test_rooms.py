"""Pure-Python unit tests for rooms.py's in-memory Room/RoomManager --
no database, no sockets, no event loop. Focused on the host-reassignment
logic in particular: it's easy to get "pick the next host automatically"
subtly wrong (picking a disconnected seat, picking a muted one, leaving the
room hostless), and there's no DB layer underneath it to catch that the way
the stored-procedure tests catch a SQL mistake.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from game.roles import GameError  # noqa: E402
from rooms import Room  # noqa: E402


def _add_players(room, n):
    for i in range(n):
        room.add_player(f"P{i}", as_host=(i == 0))


# ---------------------------------------------------------------------------
# Host reassignment on leave (lobby)
# ---------------------------------------------------------------------------


def test_host_leaving_lobby_passes_to_next_player():
    room = Room("ABCDE")
    _add_players(room, 3)
    host_token = room.host_token
    room.remove_player(host_token)
    assert room.host_token != host_token
    assert room.host_token in room.players
    assert room.players[room.host_token].is_host


def test_host_leaving_lobby_prefers_unmuted_player():
    room = Room("ABCDE")
    _add_players(room, 3)
    host_token = room.host_token
    others = [t for t in room.players if t != host_token]
    room.players[others[0]].muted = True

    room.remove_player(host_token)

    assert room.host_token == others[1]


def test_last_player_leaving_lobby_leaves_room_hostless_not_erroring():
    room = Room("ABCDE")
    _add_players(room, 1)
    room.remove_player(room.host_token)
    assert room.players == {}


# ---------------------------------------------------------------------------
# Host reassignment on mid-game disconnect (mark_disconnected)
# ---------------------------------------------------------------------------


def test_host_disconnecting_midgame_transfers_to_connected_player():
    room = Room("ABCDE")
    _add_players(room, 3)
    for p in room.players.values():
        p.connected = True
    room.phase = "in_game"
    host_token = room.host_token

    room.mark_disconnected(host_token)

    assert room.players[host_token].connected is False
    assert room.players[host_token].is_host is False
    assert room.host_token != host_token
    assert room.players[room.host_token].is_host is True
    assert room.players[room.host_token].connected is True


def test_host_disconnecting_midgame_prefers_unmuted_connected_player():
    room = Room("ABCDE")
    _add_players(room, 3)
    for p in room.players.values():
        p.connected = True
    room.phase = "in_game"
    host_token = room.host_token
    others = [t for t in room.players if t != host_token]
    room.players[others[0]].muted = True  # seat order: others[0] would otherwise be picked first

    room.mark_disconnected(host_token)

    assert room.host_token == others[1]


def test_host_disconnecting_midgame_skips_other_disconnected_seats():
    room = Room("ABCDE")
    _add_players(room, 3)
    for p in room.players.values():
        p.connected = True
    room.phase = "in_game"
    host_token = room.host_token
    others = [t for t in room.players if t != host_token]
    room.players[others[0]].connected = False  # already offline -- shouldn't become host either

    room.mark_disconnected(host_token)

    assert room.host_token == others[1]


def test_host_disconnecting_midgame_falls_back_to_muted_if_nobody_else_unmuted():
    room = Room("ABCDE")
    _add_players(room, 2)
    for p in room.players.values():
        p.connected = True
    room.phase = "in_game"
    host_token = room.host_token
    other = next(t for t in room.players if t != host_token)
    room.players[other].muted = True

    room.mark_disconnected(host_token)

    # Only one other seat exists and it's muted -- still must get host
    # rather than leaving the room with nobody who can act.
    assert room.host_token == other


def test_non_host_disconnecting_midgame_does_not_move_host():
    room = Room("ABCDE")
    _add_players(room, 3)
    for p in room.players.values():
        p.connected = True
    room.phase = "in_game"
    host_token = room.host_token
    other = next(t for t in room.players if t != host_token)

    room.mark_disconnected(other)

    assert room.host_token == host_token
    assert room.players[other].connected is False


def test_disconnect_midgame_does_not_remove_the_seat():
    """Unlike the lobby, a mid-game disconnect must never pop the player --
    their seat/role is already dealt and everything downstream (votes,
    mission history) is keyed off it."""
    room = Room("ABCDE")
    _add_players(room, 3)
    for p in room.players.values():
        p.connected = True
    room.phase = "in_game"
    other = next(t for t in room.players if t != room.host_token)

    room.mark_disconnected(other)

    assert other in room.players


# ---------------------------------------------------------------------------
# set_muted / kick_player guards (small, but exactly what's easy to get backwards)
# ---------------------------------------------------------------------------


def test_host_cannot_mute_self():
    room = Room("ABCDE")
    _add_players(room, 2)
    host_seat = room.players[room.host_token].seat_index
    with pytest.raises(GameError, match="can't mute yourself"):
        room.set_muted(room.host_token, host_seat, True)


def test_set_muted_returns_the_target_with_muted_state_already_updated():
    # socket_handlers.py's handle_set_muted logs the target's ip/
    # display_name on every mute/unmute -- needs the Player back, not just
    # a bare None, to have anything to log.
    room = Room("ABCDE")
    _add_players(room, 2)
    target = next(p for p in room.players.values() if p.token != room.host_token)
    target.ip = "203.0.113.5"
    target_seat = target.seat_index

    muted = room.set_muted(room.host_token, target_seat, True)
    assert muted.muted is True
    assert muted.ip == "203.0.113.5"
    assert muted.token == target.token

    unmuted = room.set_muted(room.host_token, target_seat, False)
    assert unmuted.muted is False


def test_kick_player_blocked_once_game_started():
    room = Room("ABCDE")
    _add_players(room, 2)
    room.phase = "in_game"
    target_seat = next(p.seat_index for p in room.players.values() if p.token != room.host_token)
    with pytest.raises(GameError, match="mute them in chat instead"):
        room.kick_player(room.host_token, target_seat)


def test_kick_player_returns_socket_id_and_player_and_removes_the_seat():
    # The (sid, target) pair matters -- socket_handlers.py's
    # handle_kick_player needs the target's token to also clean up
    # RoomManager's own token -> room-code map (a separate piece of state
    # this Room-level method has no reach into), and their ip/display_name
    # to log the kick -- not just the sid to force-disconnect them. The
    # returned Player stays fully populated even though it's already been
    # removed from the room by the time it's returned.
    room = Room("ABCDE")
    _add_players(room, 2)
    target_before = next(p for p in room.players.values() if p.token != room.host_token)
    target_before.socket_id = "sid-123"
    target_before.ip = "203.0.113.5"
    target_token = target_before.token

    sid, target = room.kick_player(room.host_token, target_before.seat_index)

    assert sid == "sid-123"
    assert target.token == target_token
    assert target.ip == "203.0.113.5"
    assert target.display_name == target_before.display_name
    assert target_token not in room.players


def test_chat_rate_limit_blocks_after_threshold():
    room = Room("ABCDE")
    _add_players(room, 1)
    token = next(iter(room.players))
    for _ in range(5):
        room.check_chat_rate_limit(token)
    with pytest.raises(GameError, match="too fast"):
        room.check_chat_rate_limit(token)


# ---------------------------------------------------------------------------
# Unique display names per room
# ---------------------------------------------------------------------------


def test_duplicate_display_name_rejected():
    room = Room("ABCDE")
    room.add_player("Alice", as_host=True)
    with pytest.raises(GameError, match="already taken"):
        room.add_player("Alice")


def test_duplicate_display_name_rejected_case_and_whitespace_insensitive():
    room = Room("ABCDE")
    room.add_player("Alice", as_host=True)
    with pytest.raises(GameError, match="already taken"):
        room.add_player("  alice ")


def test_distinct_display_names_allowed():
    room = Room("ABCDE")
    room.add_player("Alice", as_host=True)
    bob = room.add_player("Bob")  # should not raise
    assert bob.display_name == "Bob"


def test_display_name_freed_up_after_that_player_leaves():
    room = Room("ABCDE")
    room.add_player("Alice", as_host=True)
    bob = room.add_player("Bob")
    room.remove_player(bob.token)
    room.add_player("Bob")  # should not raise -- the seat's gone, name's free again


def test_add_chat_message_defaults_to_not_system():
    room = Room("ABCDE")
    entry = room.add_chat_message("Alice", "hello")
    assert entry["system"] is False
    assert room.chat[-1] == entry


def test_add_chat_message_system_flag_used_for_force_resolve_transparency():
    # socket_handlers.py's force-resolve handlers pass system=True so the
    # whole table sees a host used an escape hatch, not just the host --
    # this is the flag Chat.jsx keys off to render it distinctly.
    room = Room("ABCDE")
    entry = room.add_chat_message("Alice", "⚡ Force-resolved the stuck vote.", system=True)
    assert entry["system"] is True
    assert entry["displayName"] == "Alice"
