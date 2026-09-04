"""The paired Lancelots' allegiance swap: random, secret, and -- per an
explicit rule change -- can now land more than once, but never more than
twice. These drive games.swap_mission_numbers directly (same shape
sp_start_game persists; Room.start_game in rooms.py is what actually
chooses 1-or-2 distinct missions via random.sample(range(5), k=random.
choice([1, 2])) -- that selection itself is plain stdlib random usage with
no branch of its own worth a test, so this covers what happens once a
schedule exists instead: 0, 1, and 2 landed swaps all resolve correctly.
"""

from helpers import get_game, start_game

LANCELOT_PAIR_ROLES = {0: ("LANCELOT_GOOD", "good"), 1: ("LANCELOT_EVIL", "evil")}


async def _teams(pool, game_id):
    rows = await pool.fetch("SELECT seat, team FROM game_players WHERE game_id=$1 ORDER BY seat", game_id)
    return {r["seat"]: r["team"] for r in rows}


async def _play_mission(pool, game_id, team):
    game = await get_game(pool, game_id)
    await pool.execute("SELECT sp_propose_team($1,$2,$3)", game_id, game["leader_seat"], team)
    for seat in range(game["player_count"]):
        await pool.execute("SELECT sp_cast_team_vote($1,$2,$3)", game_id, seat, True)
    for seat in team:
        await pool.execute("SELECT sp_cast_mission_card($1,$2,$3,$4)", game_id, seat, True, False)


async def test_single_scheduled_swap_flips_once(pool):
    game_id = await start_game(
        pool, player_count=5, roles=LANCELOT_PAIR_ROLES, settings={"lancelotPair": True}, swap_mission_numbers=[0]
    )
    before = await _teams(pool, game_id)
    assert before[0] == "good" and before[1] == "evil"

    await _play_mission(pool, game_id, [0, 1])

    after = await _teams(pool, game_id)
    assert after[0] == "evil" and after[1] == "good"  # swapped
    game = await get_game(pool, game_id)
    assert game["lancelots_swap_count"] == 1


async def test_two_scheduled_swaps_flip_back(pool):
    game_id = await start_game(
        pool, player_count=5, roles=LANCELOT_PAIR_ROLES, settings={"lancelotPair": True}, swap_mission_numbers=[0, 1]
    )

    await _play_mission(pool, game_id, [0, 1])
    mid = await _teams(pool, game_id)
    assert mid[0] == "evil" and mid[1] == "good"  # first swap

    await _play_mission(pool, game_id, [0, 1, 2])
    after = await _teams(pool, game_id)
    assert after[0] == "good" and after[1] == "evil"  # second swap -- back to original
    game = await get_game(pool, game_id)
    assert game["lancelots_swap_count"] == 2


async def test_no_swap_scheduled_for_a_mission_leaves_teams_alone(pool):
    game_id = await start_game(
        pool, player_count=5, roles=LANCELOT_PAIR_ROLES, settings={"lancelotPair": True}, swap_mission_numbers=[2]
    )
    await _play_mission(pool, game_id, [0, 1])  # mission 0 -- not scheduled

    after = await _teams(pool, game_id)
    assert after[0] == "good" and after[1] == "evil"  # unchanged
    game = await get_game(pool, game_id)
    assert game["lancelots_swap_count"] == 0
