"""Excalibur's actual use flow (view -> decide) -- assignment/self-hold
restrictions on the leader's side are covered by sp_propose_team's own
validation exercised elsewhere; this covers the holder's side: viewing,
swapping, that it's available again every round (no game-wide limit), and
that it can't be turned on the holder's own card."""

import pytest

from helpers import get_game, start_game


async def _propose_vote_and_play(pool, game_id, *, team, holder_seat, player_count):
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


async def _game_at_excalibur_decision(pool, *, team, holder_seat, player_count=5):
    game_id = await start_game(
        pool, player_count=player_count, settings={"excalibur": True}, excalibur_holder_seat=holder_seat
    )
    await _propose_vote_and_play(pool, game_id, team=team, holder_seat=holder_seat, player_count=player_count)
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


async def test_excalibur_can_be_used_again_the_very_next_round(pool):
    """No game-wide limit -- swapping a card on one quest must not stop the
    next quest's leader from assigning (and using) it again."""
    game_id = await _game_at_excalibur_decision(pool, team=[0, 1], holder_seat=1, player_count=6)
    await pool.execute("SELECT sp_excalibur_view($1,$2,$3)", game_id, 1, 0)
    await pool.execute("SELECT sp_excalibur_decision($1,$2,$3)", game_id, 1, True)

    game = await get_game(pool, game_id)
    assert game["phase"] == "team_building"
    assert game["excalibur_holder_seat"] is None  # cleared for the round, not spent for the game

    # The next leader is *required* to assign it again -- proposing without
    # one must still be rejected, exactly like the very first quest.
    leader2 = game["leader_seat"]
    team2 = [s for s in range(6) if s != leader2][:3]
    with pytest.raises(Exception, match="Choose who holds Excalibur"):
        await pool.execute("SELECT sp_propose_team($1,$2,$3)", game_id, leader2, team2)

    # Assign it to someone on the new team and use it again -- must succeed.
    new_holder = next(s for s in team2 if s != leader2)
    await _propose_vote_and_play(pool, game_id, team=team2, holder_seat=new_holder, player_count=6)
    other_target = next(s for s in team2 if s != new_holder)
    await pool.execute("SELECT sp_excalibur_view($1,$2,$3)", game_id, new_holder, other_target)
    await pool.execute("SELECT sp_excalibur_decision($1,$2,$3)", game_id, new_holder, True)

    game = await get_game(pool, game_id)
    assert game["mission_number"] == 2  # both quests actually resolved
