"""Helpers for standing up a game with fully explicit, deterministic roles --
bypasses the real random dealer (backend/src/game/roles.py) entirely, since
these tests exercise the SQL state machine sp_start_game hands off to, not
role assignment itself (that's Python, and belongs in its own unit tests).
sp_start_game takes a plain list of already-dealt players, so a test can
just say "seat 2 is the Assassin" directly.
"""

from __future__ import annotations

from uuid import UUID

DEFAULT_SETTINGS = {
    "merlin": False,
    "percival": False,
    "morgana": False,
    "mordred": False,
    "oberon": False,
    "assassin": False,
    "agravain": False,
    "arthur": False,
    "gawain": False,
    "tristanIseult": False,
    "lancelot": False,
    "lancelotPair": False,
    "guinevere": False,
    "ladyOfLake": False,
    "excalibur": False,
}

# The real mission/fail table (mirrors mission_config, seeded by 001_schema.sql).
TEAM_SIZES = {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5],
}


async def start_game(
    pool,
    *,
    player_count: int = 5,
    roles: dict[int, tuple[str, str]] | None = None,
    settings: dict[str, bool] | None = None,
    leader_seat: int = 0,
    lady_holder_seat: int | None = None,
    excalibur_holder_seat: int | None = None,
    swap_mission_numbers: list[int] | None = None,
) -> UUID:
    """roles: {seat: (roleId, team)}. Any seat not given one defaults to a
    plain Loyal Servant. Returns the new game's id."""
    roles = roles or {}
    players = []
    for seat in range(player_count):
        role_id, team = roles.get(seat, ("SERVANT", "good"))
        players.append({"seat": seat, "displayName": f"P{seat}", "roleId": role_id, "team": team, "knowledge": []})

    merged_settings = {**DEFAULT_SETTINGS, **(settings or {})}
    return await pool.fetchval(
        "SELECT sp_start_game($1,$2,$3,$4,$5,$6,$7,$8)",
        f"T{player_count}{'X' * 4}",
        merged_settings,
        list(range(player_count)),
        leader_seat,
        lady_holder_seat,
        excalibur_holder_seat,
        swap_mission_numbers,
        players,
    )


async def approve_team(pool, game_id: UUID, seat_order: list[int]) -> None:
    """Every seat votes Approve, moving the game straight to the mission phase."""
    for seat in seat_order:
        await pool.execute("SELECT sp_cast_team_vote($1,$2,$3)", game_id, seat, True)


async def play_mission_cards(pool, game_id: UUID, cards: dict[int, bool]) -> None:
    """cards: {seat: success}. Plays in seat order; the last card played is
    the one that triggers resolution (or the Excalibur handoff), matching
    real submission order not mattering."""
    for seat, success in cards.items():
        await pool.execute("SELECT sp_cast_mission_card($1,$2,$3,$4)", game_id, seat, success, False)


async def get_game(pool, game_id: UUID):
    return await pool.fetchrow("SELECT * FROM games WHERE id = $1", game_id)


async def get_player(pool, game_id: UUID, seat: int):
    return await pool.fetchrow("SELECT * FROM game_players WHERE game_id = $1 AND seat = $2", game_id, seat)
