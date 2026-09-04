"""Excalibur's actual use flow (view -> decide) -- assignment/self-hold
restrictions on the leader's side are covered by sp_propose_team's own
validation exercised elsewhere; this covers the holder's side: viewing,
swapping, the once-per-game limit, and that it can't be turned on the
holder's own card."""

import pytest

from helpers import get_game, start_game


async def _game_at_excalibur_decision(pool, *, team, holder_seat, player_count=5):
    game_id = await start_game(
        pool, player_count=player_count, settings={"excalibur": True}, excalibur_holder_seat=holder_seat
    )
    game = await get_game(pool, game_id)
    await pool.execute(
        "SELECT sp_propose_team($1,$2,$3,$4)", game_id, game["leader_seat"], team, holder_seat
    )
    for seat in range(player_count):
        await pool.execute("SELECT sp_cast_team_vote($1,$2,$3)", game_id, seat, True)
    for seat in team:
        await pool.execute("SELECT sp_cast_mission_card($1,$2,$3,$4)", game_id, seat, True, False)
    game = await get_game(pool, game_id)
    assert game["phase"] == "excalibur_decision"
    return game_id


async def test_holder_cannot_view_their_own_card(pool):
    game_id = await _game_at_excalibur_decision(pool, team=[0, 1], holder_seat=1)
    with pytest.raises(Exception, match="own card"):
        await pool.execute("SELECT sp_excalibur_view($1,$2,$3)", game_id, 1, 1)


async def test_holder_can_view_and_swap_a_teammates_card(pool):
    game_id = await _game_at_excalibur_decision(pool, team=[0, 1], holder_seat=1)
    await pool.execute("SELECT sp_excalibur_view($1,$2,$3)", game_id, 1, 0)
    await pool.execute("SELECT sp_excalibur_decision($1,$2,$3)", game_id, 1, True)

    card = await pool.fetchrow(
        "SELECT success FROM mission_cards WHERE game_id=$1 AND mission_number=0 AND seat=0", game_id
    )
    assert card["success"] is False  # flipped from the originally-played Success

    game = await get_game(pool, game_id)
    assert game["excalibur_used"] is True


async def test_excalibur_cannot_be_used_a_second_time_in_the_game(pool):
    game_id = await _game_at_excalibur_decision(pool, team=[0, 1], holder_seat=1, player_count=6)
    await pool.execute("SELECT sp_excalibur_view($1,$2,$3)", game_id, 1, 0)
    await pool.execute("SELECT sp_excalibur_decision($1,$2,$3)", game_id, 1, True)

    game = await get_game(pool, game_id)
    assert game["phase"] == "team_building"
    assert game["excalibur_holder_seat"] is None  # not reassigned -- it's spent

    # The next leader proposes a team without an Excalibur seat at all --
    # must succeed, since it's no longer required (or even allowed).
    leader2 = game["leader_seat"]
    team2 = [s for s in range(6) if s != leader2][:3]
    await pool.execute("SELECT sp_propose_team($1,$2,$3)", game_id, leader2, team2)
    game = await get_game(pool, game_id)
    assert game["phase"] == "team_voting"
    assert game["excalibur_holder_seat"] is None
