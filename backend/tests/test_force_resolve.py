"""The host-only "stuck phase" escape hatches: sp_force_resolve_mission,
sp_force_resolve_team_vote, sp_force_decline_excalibur,
sp_force_resolve_lady_of_lake, and sp_force_pass_assassination. Each exists
because a specific seat disconnecting mid-phase could otherwise stall a game
forever -- these are what actually gets tested here, not just "does the
function run": that a stall really does resolve, that it resolves the way
the design note in the migration file promises (charitable defaults,
Agravain's real constraint still honored, no forced card swaps, no handing
either side a win they didn't earn), and that calling one speculatively
when nothing's actually stuck yet is a safe no-op.
"""

import pytest

from helpers import get_game, start_game

ASSASSIN_ROLES = {2: ("ASSASSIN", "evil")}


# ---------------------------------------------------------------------------
# sp_force_resolve_mission
# ---------------------------------------------------------------------------


async def test_force_resolve_mission_fills_success_and_resolves(pool):
    game_id = await start_game(pool, player_count=5)
    game = await get_game(pool, game_id)
    team = [0, 1]
    await pool.execute("SELECT sp_propose_team($1,$2,$3)", game_id, game["leader_seat"], team)
    for seat in range(5):
        await pool.execute("SELECT sp_cast_team_vote($1,$2,$3)", game_id, seat, True)

    # Nobody's played yet; both team seats are "disconnected".
    await pool.execute("SELECT sp_force_resolve_mission($1,$2)", game_id, team)

    game = await get_game(pool, game_id)
    assert game["mission_number"] == 1  # advanced past mission 0 -- it resolved
    missions = await pool.fetch("SELECT * FROM game_missions WHERE game_id=$1", game_id)
    assert len(missions) == 1
    assert missions[0]["result"] == "success"
    assert missions[0]["fail_count"] == 0


async def test_force_resolve_mission_agravain_still_forced_to_fail(pool):
    game_id = await start_game(pool, player_count=5, roles={1: ("AGRAVAIN", "evil")})
    game = await get_game(pool, game_id)
    team = [0, 1]
    await pool.execute("SELECT sp_propose_team($1,$2,$3)", game_id, game["leader_seat"], team)
    for seat in range(5):
        await pool.execute("SELECT sp_cast_team_vote($1,$2,$3)", game_id, seat, True)

    await pool.execute("SELECT sp_force_resolve_mission($1,$2)", game_id, team)

    card = await pool.fetchrow(
        "SELECT success FROM mission_cards WHERE game_id=$1 AND mission_number=0 AND seat=1", game_id
    )
    assert card["success"] is False  # Agravain, not the charitable default


async def test_force_resolve_mission_noop_when_connected_player_hasnt_played(pool):
    game_id = await start_game(pool, player_count=5)
    game = await get_game(pool, game_id)
    team = [0, 1]
    await pool.execute("SELECT sp_propose_team($1,$2,$3)", game_id, game["leader_seat"], team)
    for seat in range(5):
        await pool.execute("SELECT sp_cast_team_vote($1,$2,$3)", game_id, seat, True)

    # Only seat 0 is reported disconnected -- seat 1 just hasn't played, and
    # isn't disconnected, so this must not resolve the mission out from
    # under them.
    await pool.execute("SELECT sp_force_resolve_mission($1,$2)", game_id, [0])

    game = await get_game(pool, game_id)
    assert game["phase"] == "mission"
    assert game["mission_number"] == 0
    cards = await pool.fetch("SELECT seat FROM mission_cards WHERE game_id=$1", game_id)
    assert {r["seat"] for r in cards} == {0}


# ---------------------------------------------------------------------------
# sp_force_resolve_team_vote
# ---------------------------------------------------------------------------


async def test_force_resolve_team_vote_fills_approve_and_resolves(pool):
    game_id = await start_game(pool, player_count=5)
    game = await get_game(pool, game_id)
    await pool.execute("SELECT sp_propose_team($1,$2,$3)", game_id, game["leader_seat"], [0, 1])
    await pool.execute("SELECT sp_cast_team_vote($1,$2,$3)", game_id, 0, True)

    # Seats 1-4 all "disconnected" and haven't voted.
    await pool.execute("SELECT sp_force_resolve_team_vote($1,$2)", game_id, [1, 2, 3, 4])

    game = await get_game(pool, game_id)
    assert game["phase"] == "mission"  # 5/5 approve
    votes = await pool.fetch("SELECT approve FROM team_votes WHERE game_id=$1", game_id)
    assert all(v["approve"] for v in votes)
    assert len(votes) == 5


async def test_force_resolve_team_vote_noop_if_still_short(pool):
    game_id = await start_game(pool, player_count=5)
    game = await get_game(pool, game_id)
    await pool.execute("SELECT sp_propose_team($1,$2,$3)", game_id, game["leader_seat"], [0, 1])

    # Only seat 1 reported disconnected -- seats 2-4 are connected and
    # simply haven't voted, so this must stay in team_voting.
    await pool.execute("SELECT sp_force_resolve_team_vote($1,$2)", game_id, [1])

    game = await get_game(pool, game_id)
    assert game["phase"] == "team_voting"


async def test_force_resolve_team_vote_does_not_reject_5th_attempt_unfairly(pool):
    """Charitable-default Approve means a force-resolve can never itself be
    what pushes rejection_count to 5 -- confirms the default really is
    Approve, not Reject, by checking a force-resolved round doesn't
    increment rejection_count at all when it approves."""
    game_id = await start_game(pool, player_count=5)
    game = await get_game(pool, game_id)
    await pool.execute("SELECT sp_propose_team($1,$2,$3)", game_id, game["leader_seat"], [0, 1])
    await pool.execute("SELECT sp_force_resolve_team_vote($1,$2)", game_id, [0, 1, 2, 3, 4])

    game = await get_game(pool, game_id)
    assert game["phase"] == "mission"
    assert game["rejection_count"] == 0


# ---------------------------------------------------------------------------
# sp_force_decline_excalibur
# ---------------------------------------------------------------------------


async def _game_in_excalibur_decision(pool, *, view_first: bool):
    game_id = await start_game(
        pool, player_count=5, settings={"excalibur": True}, excalibur_holder_seat=1
    )
    game = await get_game(pool, game_id)
    await pool.execute("SELECT sp_propose_team($1,$2,$3,$4)", game_id, game["leader_seat"], [0, 1], 1)
    for seat in range(5):
        await pool.execute("SELECT sp_cast_team_vote($1,$2,$3)", game_id, seat, True)
    await pool.execute("SELECT sp_cast_mission_card($1,$2,$3,$4)", game_id, 0, True, False)
    await pool.execute("SELECT sp_cast_mission_card($1,$2,$3,$4)", game_id, 1, True, False)

    game = await get_game(pool, game_id)
    assert game["phase"] == "excalibur_decision"
    if view_first:
        await pool.execute("SELECT sp_excalibur_view($1,$2,$3)", game_id, 1, 0)
    return game_id


async def test_force_decline_excalibur_without_ever_viewing(pool):
    game_id = await _game_in_excalibur_decision(pool, view_first=False)
    await pool.execute("SELECT sp_force_decline_excalibur($1)", game_id)

    game = await get_game(pool, game_id)
    assert game["phase"] != "excalibur_decision"  # resolved onward
    assert game["excalibur_holder_seat"] is None
    event = await pool.fetchrow("SELECT * FROM excalibur_events WHERE game_id=$1", game_id)
    assert event["used"] is False
    assert event["target_seat"] is None

    # The card is untouched -- Success, as originally played.
    card = await pool.fetchrow(
        "SELECT success FROM mission_cards WHERE game_id=$1 AND mission_number=0 AND seat=0", game_id
    )
    assert card["success"] is True


async def test_force_decline_excalibur_after_viewing_leaves_card_unchanged(pool):
    game_id = await _game_in_excalibur_decision(pool, view_first=True)
    await pool.execute("SELECT sp_force_decline_excalibur($1)", game_id)

    event = await pool.fetchrow("SELECT * FROM excalibur_events WHERE game_id=$1", game_id)
    assert event["used"] is False
    assert event["target_seat"] == 0
    assert event["original_success"] is True

    card = await pool.fetchrow(
        "SELECT success FROM mission_cards WHERE game_id=$1 AND mission_number=0 AND seat=0", game_id
    )
    assert card["success"] is True  # never swapped


async def test_force_decline_excalibur_wrong_phase_rejected(pool):
    game_id = await start_game(pool, player_count=5, settings={"excalibur": True})
    with pytest.raises(Exception, match="Excalibur decision phase"):
        await pool.execute("SELECT sp_force_decline_excalibur($1)", game_id)


# ---------------------------------------------------------------------------
# sp_force_resolve_lady_of_lake
# ---------------------------------------------------------------------------


async def test_force_resolve_lady_of_lake_transfers_holder(pool):
    game_id = await start_game(pool, player_count=5, settings={"ladyOfLake": True}, lady_holder_seat=0)
    await pool.execute("UPDATE games SET phase = 'lady_of_lake', mission_number = 1 WHERE id = $1", game_id)

    await pool.execute("SELECT sp_force_resolve_lady_of_lake($1,$2)", game_id, 2)

    game = await get_game(pool, game_id)
    assert game["phase"] == "team_building"
    assert game["lady_holder_seat"] == 2
    assert 0 in game["lady_history"]
    event = await pool.fetchrow("SELECT * FROM lady_of_lake_events WHERE game_id=$1", game_id)
    assert event["holder_seat"] == 0
    assert event["target_seat"] == 2


async def test_force_resolve_lady_of_lake_rejects_already_held_seat(pool):
    game_id = await start_game(pool, player_count=5, settings={"ladyOfLake": True}, lady_holder_seat=0)
    await pool.execute(
        "UPDATE games SET phase = 'lady_of_lake', mission_number = 2, lady_history = ARRAY[3]::SMALLINT[] WHERE id = $1",
        game_id,
    )

    with pytest.raises(Exception, match="not already held"):
        await pool.execute("SELECT sp_force_resolve_lady_of_lake($1,$2)", game_id, 3)


# ---------------------------------------------------------------------------
# sp_force_pass_assassination
# ---------------------------------------------------------------------------


async def test_force_pass_assassination_good_wins_nobody_flagged(pool):
    game_id = await start_game(pool, player_count=5, roles=ASSASSIN_ROLES)
    await pool.execute("UPDATE games SET phase = 'assassination' WHERE id = $1", game_id)

    await pool.execute("SELECT sp_force_pass_assassination($1)", game_id)

    game = await get_game(pool, game_id)
    assert game["phase"] == "game_over"
    assert game["winner"] == "good"
    assert game["assassination_target"] == []
    flagged = await pool.fetch(
        "SELECT seat FROM game_players WHERE game_id=$1 AND was_assassinated = true", game_id
    )
    assert flagged == []


async def test_force_pass_assassination_wrong_phase_rejected(pool):
    game_id = await start_game(pool, player_count=5, roles=ASSASSIN_ROLES)
    with pytest.raises(Exception, match="assassination phase"):
        await pool.execute("SELECT sp_force_pass_assassination($1)", game_id)
