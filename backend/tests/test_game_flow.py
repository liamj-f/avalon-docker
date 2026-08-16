"""Happy-path coverage for the core state machine: a team gets proposed,
voted on, and a quest resolves, repeated until one side's win condition
fires. No Excalibur/Lady of the Lake/Assassin here -- those get their own
files -- just the bare mission/vote loop every game goes through.
"""

import pytest

from helpers import TEAM_SIZES, approve_team, get_game, play_mission_cards, start_game


async def _run_mission(pool, game_id, seat_order, team_size, successes):
    """Proposes a team of the next `team_size` seats (leader always seat 0
    for simplicity, revolving isn't the point of these tests), gets it
    unanimously approved, and plays `successes` Success cards plus enough
    Fails to round out the team."""
    game = await get_game(pool, game_id)
    team = seat_order[:team_size]
    await pool.execute("SELECT sp_propose_team($1,$2,$3)", game_id, game["leader_seat"], team)
    await approve_team(pool, game_id, seat_order)

    fails = team_size - successes
    cards = {seat: True for seat in team[:successes]}
    cards.update({seat: False for seat in team[successes:]})
    assert len(cards) == team_size
    assert sum(1 for v in cards.values() if not v) == fails
    await play_mission_cards(pool, game_id, cards)


async def test_good_wins_by_three_successful_missions(pool):
    seat_order = list(range(5))
    game_id = await start_game(pool, player_count=5)
    sizes = TEAM_SIZES[5]

    for mission_number in range(3):
        await _run_mission(pool, game_id, seat_order, sizes[mission_number], successes=sizes[mission_number])

    game = await get_game(pool, game_id)
    assert game["phase"] == "game_over"
    assert game["winner"] == "good"
    assert game["win_reason"] == "missions"


async def test_evil_wins_by_three_failed_missions(pool):
    seat_order = list(range(5))
    # Everyone Evil, purely so every seat is *allowed* to play Fail --
    # "Good players must play Success" is a real, separately-tested
    # constraint (see sp_cast_mission_card), not something this win-
    # condition test cares about.
    roles = {seat: ("MINION", "evil") for seat in seat_order}
    game_id = await start_game(pool, player_count=5, roles=roles)
    sizes = TEAM_SIZES[5]

    for mission_number in range(3):
        # One fail is always >= fails_required (1) at 5 players.
        await _run_mission(pool, game_id, seat_order, sizes[mission_number], successes=sizes[mission_number] - 1)

    game = await get_game(pool, game_id)
    assert game["phase"] == "game_over"
    assert game["winner"] == "evil"
    assert game["win_reason"] == "missions"


async def test_evil_wins_by_five_rejected_proposals(pool):
    seat_order = list(range(5))
    game_id = await start_game(pool, player_count=5)
    team = seat_order[:2]

    for attempt in range(5):
        game = await get_game(pool, game_id)
        assert game["rejection_count"] == attempt
        await pool.execute("SELECT sp_propose_team($1,$2,$3)", game_id, game["leader_seat"], team)
        for seat in seat_order:
            await pool.execute("SELECT sp_cast_team_vote($1,$2,$3)", game_id, seat, False)

    game = await get_game(pool, game_id)
    assert game["phase"] == "game_over"
    assert game["winner"] == "evil"
    assert game["win_reason"] == "vote_track"


async def test_duplicate_vote_rejected(pool):
    game_id = await start_game(pool, player_count=5)
    game = await get_game(pool, game_id)
    await pool.execute("SELECT sp_propose_team($1,$2,$3)", game_id, game["leader_seat"], [0, 1])
    await pool.execute("SELECT sp_cast_team_vote($1,$2,$3)", game_id, 0, True)

    with pytest.raises(Exception, match="already voted"):
        await pool.execute("SELECT sp_cast_team_vote($1,$2,$3)", game_id, 0, False)


async def test_wrong_phase_rejected(pool):
    game_id = await start_game(pool, player_count=5)
    # Game starts in team_building -- a mission card can't be played yet.
    with pytest.raises(Exception, match="mission phase"):
        await pool.execute("SELECT sp_cast_mission_card($1,$2,$3,$4)", game_id, 0, True, False)
