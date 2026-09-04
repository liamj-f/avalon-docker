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


def _excalibur_summary_for_mission(event: Any) -> dict[str, Any]:
    """The public half of one quest's excalibur_events row (see the query in
    load_game_state_for_seat) -- who held it, who they viewed, and whether
    they used it on them. The viewed seat is public regardless of whether it
    was used -- broader than the base rule's "everyone learns who it was
    used *on*", but that's the explicit follow-up rule this app implements.
    The target's original/new card value stays private, surfaced only to the
    holder and the target themselves, below."""
    if event is None:
        return {"excaliburHolderSeat": None, "excaliburUsed": False, "excaliburTargetSeat": None}
    return {
        "excaliburHolderSeat": event["holder_seat"],
        "excaliburUsed": event["used"],
        "excaliburTargetSeat": event["target_seat"],
    }


async def start_game(
    *,
    room_code: str,
    settings: dict[str, Any],
    seat_order: list[int],
    leader_seat: int,
    lady_holder_seat: int | None,
    excalibur_holder_seat: int | None,
    swap_mission_numbers: list[int] | None,
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
        swap_mission_numbers,
        players,
    )


async def propose_team(game_id: UUID, leader_seat: int, team: list[int], excalibur_seat: int | None = None) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_propose_team($1,$2,$3,$4)", game_id, leader_seat, team, excalibur_seat)


async def cast_team_vote(game_id: UUID, seat: int, approve: bool) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_cast_team_vote($1,$2,$3)", game_id, seat, approve)


async def cast_mission_vote(game_id: UUID, seat: int, success: bool, reverse: bool = False) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_cast_mission_card($1,$2,$3,$4)", game_id, seat, success, reverse)


async def force_resolve_mission(game_id: UUID, disconnected_seats: list[int]) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_force_resolve_mission($1,$2)", game_id, disconnected_seats)


async def force_resolve_team_vote(game_id: UUID, disconnected_seats: list[int]) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_force_resolve_team_vote($1,$2)", game_id, disconnected_seats)


async def force_advance_leader(game_id: UUID) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_force_advance_leader($1)", game_id)


async def force_decline_excalibur(game_id: UUID) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_force_decline_excalibur($1)", game_id)


async def force_resolve_lady_of_lake(game_id: UUID, target_seat: int) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_force_resolve_lady_of_lake($1,$2)", game_id, target_seat)


async def force_pass_assassination(game_id: UUID) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_force_pass_assassination($1)", game_id)


async def get_assassin_seat(game_id: UUID) -> int | None:
    """The Assassin's identity is otherwise secret -- this exists only so
    the host can be told *whether* the seat that needs to act is
    disconnected (see rooms.py's serialize_for_token), never which seat it
    actually is."""
    pool = await get_pool()
    return await pool.fetchval("SELECT seat FROM game_players WHERE game_id = $1 AND role = 'ASSASSIN'", game_id)


async def reveal_arthur(game_id: UUID, seat: int) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_reveal_arthur($1,$2)", game_id, seat)


async def excalibur_view(game_id: UUID, seat: int, target_seat: int) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_excalibur_view($1,$2,$3)", game_id, seat, target_seat)


async def excalibur_decision(game_id: UUID, seat: int, use: bool, new_success: bool | None = None) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_excalibur_decision($1,$2,$3,$4)", game_id, seat, use, new_success)


async def use_lady_of_lake(game_id: UUID, seat: int, target_seat: int) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_use_lady_of_lake($1,$2,$3)", game_id, seat, target_seat)


async def submit_assassination(game_id: UUID, seat: int, target_seats: list[int]) -> None:
    pool = await get_pool()
    await pool.execute("SELECT sp_submit_assassination($1,$2,$3)", game_id, seat, target_seats)


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

    # The raw cards actually submitted, regardless of any later Excalibur
    # cleanse -- game_missions.fail_count above is the *effective* count
    # used to decide the result, which can differ from what was really
    # played. Aggregated by mission_number only (never per-seat): who
    # played what stays secret, but the tally itself is exactly what gets
    # announced at the table once a quest resolves.
    card_count_rows = await pool.fetch(
        """SELECT mission_number,
                  COUNT(*) FILTER (WHERE success AND NOT reversed)::int AS success_count,
                  COUNT(*) FILTER (WHERE NOT success AND NOT reversed)::int AS fail_count,
                  COUNT(*) FILTER (WHERE reversed)::int AS reverse_count
             FROM mission_cards WHERE game_id = $1 GROUP BY mission_number""",
        game_id,
    )
    card_counts = {
        r["mission_number"]: {"success": r["success_count"], "fail": r["fail_count"], "reverse": r["reverse_count"]}
        for r in card_count_rows
    }

    # One row per quest that actually went through the Excalibur decision
    # phase (used=true or false) -- see sp_excalibur_decision. Publicly:
    # who held it, whether they used it, and who they targeted (real
    # Avalon rule: everyone learns *that*). The target's original card and
    # what it became stay private -- only surfaced below to the holder and
    # the target themselves, in `you`.
    excalibur_event_rows = await pool.fetch(
        """SELECT mission_number, holder_seat, used, target_seat, original_success, original_reversed, new_success
             FROM excalibur_events WHERE game_id = $1 ORDER BY mission_number""",
        game_id,
    )
    excalibur_events_by_mission = {r["mission_number"]: r for r in excalibur_event_rows}

    # The paired Lancelots' swap is not secret about *when* it happens --
    # only *who* is involved stays hidden. games.swap_mission_numbers is
    # the full schedule (1 or 2 missions, chosen at deal time), but this
    # only ever gets compared against mission_rows above, which by
    # construction holds nothing but already-resolved missions -- so this
    # can never leak a future scheduled swap, only confirm one that's
    # already happened, exactly when it happened.
    swap_mission_numbers = set(g["swap_mission_numbers"] or [])

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
                "cardCounts": card_counts.get(m["mission_number"], {"success": 0, "fail": 0, "reverse": 0}),
                **_excalibur_summary_for_mission(excalibur_events_by_mission.get(m["mission_number"])),
                # True the instant this specific quest is the one the pair
                # swapped on -- announced with the rest of the quest's
                # result, not held back for some later standing banner.
                "lancelotsSwapped": m["mission_number"] in swap_mission_numbers,
            }
            for m in mission_rows
        ],
        "winner": g["winner"],
        "winReason": g["win_reason"],
        "assassinationTargets": g["assassination_target"] or [],
        "hasAssassin": bool(settings.get("assassin")),
        "hasGawain": bool(settings.get("gawain")),
        "hasTristanIseult": bool(settings.get("tristanIseult")),
        "hasLadyOfLake": bool(settings.get("ladyOfLake")),
        "hasExcalibur": bool(settings.get("excalibur")),
        "hasLancelot": bool(settings.get("lancelot")),
        "hasLancelotPair": bool(settings.get("lancelotPair")),
        # Both tokens are physical props at the table -- who holds them is
        # always public. Lady of the Lake's holder changes hands as it's
        # used; Excalibur's is re-assigned by each quest's leader as part of
        # proposing the team (sp_propose_team) and stays that way through
        # team_voting/mission/excalibur_decision for the current quest, null
        # otherwise (not yet (re-)assigned this round -- there's no
        # game-wide "spent for good" anymore, it's reassigned every round;
        # see migration 006).
        "ladyHolderSeat": g["lady_holder_seat"] if settings.get("ladyOfLake") else None,
        "excaliburHolderSeat": g["excalibur_holder_seat"] if settings.get("excalibur") else None,
        # Whether Lancelot's Reverse card / the paired Lancelots' swap have
        # happened is safe to broadcast to everyone: it never says who's
        # involved, just that the event occurred. This is the "as of right
        # now" aggregate (has it swapped at least once); missionResults[]
        # below carries the same fact per-quest, so anyone can already see
        # exactly *when* each swap landed -- not secret, only who stays
        # hidden.
        "lancelotReverseUsed": g["lancelot_reverse_used"] if settings.get("lancelot") else None,
        "lancelotsSwapped": (g["lancelots_swap_count"] > 0) if settings.get("lancelotPair") else None,
    }

    public_reveals = await pool.fetch(
        "SELECT seat, role, team FROM game_players WHERE game_id = $1 AND revealed = true ORDER BY seat",
        game_id,
    )
    base["publicReveals"] = [
        {"seat": r["seat"], "roleId": r["role"], "role": ROLES[r["role"]]["name"], "team": r["team"]}
        for r in public_reveals
    ]

    # Every past team vote, in full -- who proposed it, who was on it, and
    # (once it's actually resolved) how each seat voted. Real Avalon reveals
    # a vote's individual choices the instant everyone's in, all at once, so
    # the one attempt currently being voted on (if any) is deliberately
    # left out here rather than dribbled out card-by-card as votes arrive --
    # VotePanel's votesInSoFar/hasVoted already covers that in-progress
    # count without leaking anyone's actual choice early.
    live_attempt = (g["mission_number"], g["rejection_count"]) if g["phase"] == "team_voting" else None
    proposal_rows = await pool.fetch(
        """SELECT mission_number, attempt, leader_seat, team_seats, excalibur_seat
             FROM team_proposals WHERE game_id = $1 ORDER BY mission_number, attempt""",
        game_id,
    )
    vote_rows = await pool.fetch(
        """SELECT mission_number, attempt, seat, approve
             FROM team_votes WHERE game_id = $1 ORDER BY mission_number, attempt, seat""",
        game_id,
    )
    votes_by_attempt: dict[tuple[int, int], list[dict[str, Any]]] = {}
    for v in vote_rows:
        votes_by_attempt.setdefault((v["mission_number"], v["attempt"]), []).append(
            {"seat": v["seat"], "approve": v["approve"]}
        )

    vote_history = []
    for p in proposal_rows:
        key = (p["mission_number"], p["attempt"])
        if key == live_attempt:
            continue
        votes = votes_by_attempt.get(key, [])
        approvals = sum(1 for v in votes if v["approve"])
        vote_history.append(
            {
                "missionNumber": p["mission_number"],
                "attempt": p["attempt"],
                "leaderSeat": p["leader_seat"],
                "team": p["team_seats"],
                "excaliburSeat": p["excalibur_seat"],
                "votes": votes,
                "approved": (approvals * 2 > len(votes)) if votes else None,
            }
        )
    base["voteHistory"] = vote_history

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

            if settings.get("excalibur"):
                if g["phase"] == "excalibur_decision" and g["excalibur_holder_seat"] == seat:
                    # The holder doesn't get to browse every card -- they
                    # pick one participant (sp_excalibur_view) and only that
                    # one's real card is ever exposed here, once it's been
                    # picked. Before picking, the frontend only needs the
                    # public proposedTeam seats to offer as choices.
                    if g["excalibur_viewing_seat"] is not None:
                        viewed = await pool.fetchrow(
                            """SELECT seat, success, reversed FROM mission_cards
                                 WHERE game_id = $1 AND mission_number = $2 AND seat = $3""",
                            game_id,
                            g["mission_number"],
                            g["excalibur_viewing_seat"],
                        )
                        if viewed is not None:
                            you["excaliburViewing"] = {
                                "targetSeat": viewed["seat"],
                                "success": viewed["success"],
                                "reversed": viewed["reversed"],
                            }

                # Forever after, too: the target's original card value stays
                # private to the holder and the target themselves -- both
                # legitimately already know it (the holder because they
                # viewed it, the target because they're the one who played
                # it) regardless of whether it ended up getting swapped.
                you["excaliburReveals"] = [
                    {
                        "missionNumber": e["mission_number"],
                        "targetSeat": e["target_seat"],
                        "originalSuccess": e["original_success"],
                        "originalReversed": e["original_reversed"],
                        "newSuccess": e["new_success"],
                        "used": e["used"],
                        "wasHolder": e["holder_seat"] == seat,
                    }
                    for e in excalibur_event_rows
                    if e["holder_seat"] == seat or e["target_seat"] == seat
                ]

            base["you"] = you

    if g["phase"] == "game_over":
        reveal = await pool.fetch("SELECT seat, role, team FROM game_players WHERE game_id = $1 ORDER BY seat", game_id)
        base["reveal"] = [
            {"seat": r["seat"], "roleId": r["role"], "role": ROLES[r["role"]]["name"], "team": r["team"]} for r in reveal
        ]

    return base
