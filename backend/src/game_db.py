"""Calls the sp_* stored procedures and reads back per-seat-redacted game
state straight from the tables they maintain. This is the Python
counterpart to the earlier design's in-memory AvalonGame.serializeForSeat()
-- just backed by SQL SELECTs instead of an object in RAM. The dict shapes
returned here are sent to the frontend as-is (over Socket.IO as JSON), so
keys are deliberately camelCase to match what the unchanged React app
already expects.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from db import get_pool
from game.roles import ROLES


async def start_game(
    *,
    room_code: str,
    settings: dict[str, Any],
    seat_order: list[int],
    leader_seat: int,
    lady_holder_seat: int | None,
    excalibur_holder_seat: int | None,
    swap_mission_number: int | None,
    players: list[dict[str, Any]],
) -> UUID:
    """Persists a freshly-dealt game and its initial turn state. Returns the new games.id."""
    pool = await get_pool()
    return await pool.fetchval(
        "SELECT sp_start_game($1,$2,$3,$4,$5,$6,$7,$8)",
        room_code,
        settings,
        seat_order,
        leader_seat,
        lady_holder_seat,
        excalibur_holder_seat,
        swap_mission_number,
        players,
    )


async def propose_team(game_id: UUID, leader_seat: int, team: list[int]) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_propose_team($1,$2,$3)", game_id, leader_seat, team)


async def cast_team_vote(game_id: UUID, seat: int, approve: bool) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_cast_team_vote($1,$2,$3)", game_id, seat, approve)


async def cast_mission_vote(game_id: UUID, seat: int, success: bool, reverse: bool = False) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_cast_mission_card($1,$2,$3,$4)", game_id, seat, success, reverse)


async def reveal_arthur(game_id: UUID, seat: int) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_reveal_arthur($1,$2)", game_id, seat)


async def excalibur_decision(game_id: UUID, seat: int, use: bool) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_excalibur_decision($1,$2,$3)", game_id, seat, use)


async def use_lady_of_lake(game_id: UUID, seat: int, target_seat: int) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_use_lady_of_lake($1,$2,$3)", game_id, seat, target_seat)


async def submit_assassination(game_id: UUID, seat: int, target_seat: int) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_submit_assassination($1,$2,$3)", game_id, seat, target_seat)


async def load_game_state_for_seat(game_id: UUID, seat: int | None) -> dict[str, Any] | None:
    pool = await get_pool()

    g = await pool.fetchrow("SELECT * FROM games WHERE id = $1", game_id)
    if g is None:
        return None

    mc = await pool.fetchrow("SELECT * FROM mission_config WHERE player_count = $1", g["player_count"])

    mission_rows = await pool.fetch(
        """SELECT mission_number, team_size, fails_required, team_seats, result, fail_count
             FROM game_missions WHERE game_id = $1 ORDER BY mission_number""",
        game_id,
    )

    settings = g["settings"]

    base: dict[str, Any] = {
        "phase": g["phase"],
        "missionNumber": g["mission_number"],
        "teamSizes": mc["team_sizes"],
        "failsRequired": mc["fails_required"],
        "leaderSeat": g["leader_seat"],
        "proposedTeam": g["proposed_team"] or [],
        "rejectionCount": g["rejection_count"],
        "missionResults": [
            {
                "missionNumber": m["mission_number"],
                "teamSize": m["team_size"],
                "failsRequired": m["fails_required"],
                "team": m["team_seats"],
                "result": m["result"],
                "failCount": m["fail_count"],
            }
            for m in mission_rows
        ],
        "winner": g["winner"],
        "winReason": g["win_reason"],
        "assassinationTarget": g["assassination_target"],
        "hasAssassin": bool(settings.get("assassin")),
        "hasLadyOfLake": bool(settings.get("ladyOfLake")),
        "hasExcalibur": bool(settings.get("excalibur")),
        "hasLancelot": bool(settings.get("lancelot")),
        "hasLancelotPair": bool(settings.get("lancelotPair")),
        # Both tokens are physical props at the table in the rules this app
        # implements -- who holds them is public, only what the holder
        # learns (a loyalty check, a peek at a mission's fail count) is private.
        "ladyHolderSeat": g["lady_holder_seat"] if settings.get("ladyOfLake") else None,
        "excaliburHolderSeat": g["excalibur_holder_seat"] if settings.get("excalibur") else None,
        "excaliburUsed": g["excalibur_used"],
        # Whether Lancelot's Reverse card / the paired Lancelots' swap have
        # happened is safe to broadcast to everyone: it never says who's
        # involved, just that the event occurred.
        "lancelotReverseUsed": g["lancelot_reverse_used"] if settings.get("lancelot") else None,
        "lancelotsSwapped": g["lancelots_swapped"] if settings.get("lancelotPair") else None,
    }

    public_reveals = await pool.fetch(
        "SELECT seat, role, team FROM game_players WHERE game_id = $1 AND revealed = true ORDER BY seat",
        game_id,
    )
    base["publicReveals"] = [
        {"seat": r["seat"], "roleId": r["role"], "role": ROLES[r["role"]]["name"], "team": r["team"]}
        for r in public_reveals
    ]

    if g["phase"] == "team_voting":
        row = await pool.fetchrow(
            """SELECT COUNT(*)::int AS total, BOOL_OR(seat = $1) AS voted
                 FROM team_votes WHERE game_id = $2 AND mission_number = $3 AND attempt = $4""",
            seat,
            game_id,
            g["mission_number"],
            g["rejection_count"],
        )
        base["votesInSoFar"] = row["total"]
        base["hasVoted"] = bool(row["voted"])

    if g["phase"] == "mission":
        row = await pool.fetchrow(
            """SELECT COUNT(*)::int AS total, BOOL_OR(seat = $1) AS played
                 FROM mission_cards WHERE game_id = $2 AND mission_number = $3""",
            seat,
            game_id,
            g["mission_number"],
        )
        base["missionVotesInSoFar"] = row["total"]
        base["hasPlayedMissionCard"] = bool(row["played"])

    if seat is not None:
        gp = await pool.fetchrow(
            "SELECT role, team, knowledge, revealed FROM game_players WHERE game_id = $1 AND seat = $2",
            game_id,
            seat,
        )
        if gp is not None:
            you: dict[str, Any] = {
                "seat": seat,
                "role": ROLES[gp["role"]]["name"],
                "roleId": gp["role"],
                "team": gp["team"],
                "description": ROLES[gp["role"]]["description"],
                "knowledge": gp["knowledge"],
                "revealed": gp["revealed"],
            }

            if gp["role"] == "LANCELOT":
                you["hasReverseCard"] = not g["lancelot_reverse_used"]

            if settings.get("ladyOfLake"):
                reveals = await pool.fetch(
                    """SELECT mission_number, target_seat, revealed_team
                         FROM lady_of_lake_events WHERE game_id = $1 AND holder_seat = $2 ORDER BY mission_number""",
                    game_id,
                    seat,
                )
                you["ladyOfLakeReveals"] = [
                    {"missionNumber": r["mission_number"], "targetSeat": r["target_seat"], "team": r["revealed_team"]}
                    for r in reveals
                ]

            if settings.get("excalibur") and g["phase"] == "excalibur_decision" and g["excalibur_holder_seat"] == seat:
                you["excaliburPendingFailCount"] = g["pending_fail_count"]

            base["you"] = you

    if g["phase"] == "game_over":
        reveal = await pool.fetch("SELECT seat, role, team FROM game_players WHERE game_id = $1 ORDER BY seat", game_id)
        base["reveal"] = [
            {"seat": r["seat"], "roleId": r["role"], "role": ROLES[r["role"]]["name"], "team": r["team"]} for r in reveal
        ]

    return base
