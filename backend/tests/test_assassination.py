"""sp_submit_assassination's three modes. The Gawain case in particular is a
direct regression test for a real bug in this app's own history (see
README's "Gawain wins for himself, not Evil" design note): an earlier round
had a Gawain hit resolve as `winner = 'evil'`, which is wrong -- Gawain is a
third faction with his own win condition, distinct from Evil's actual guess
(Merlin) being wrong.
"""

import pytest

from helpers import get_game, start_game

ROLES = {
    0: ("MERLIN", "good"),
    1: ("GAWAIN", "good"),
    2: ("ASSASSIN", "evil"),
    3: ("TRISTAN", "good"),
    4: ("ISEULT", "good"),
}


async def _game_ready_for_assassination(pool, **settings):
    game_id = await start_game(pool, player_count=5, roles=ROLES, settings=settings)
    # sp_submit_assassination only checks phase, not how it got there --
    # jump straight there rather than replaying 3 missions to reach it.
    await pool.execute("UPDATE games SET phase = 'assassination' WHERE id = $1", game_id)
    return game_id


async def test_naming_merlin_evil_wins(pool):
    game_id = await _game_ready_for_assassination(pool)
    await pool.execute("SELECT sp_submit_assassination($1,$2,$3)", game_id, 2, [0])
    game = await get_game(pool, game_id)
    assert game["winner"] == "evil"
    player = await pool.fetchrow("SELECT was_assassinated FROM game_players WHERE game_id=$1 AND seat=0", game_id)
    assert player["was_assassinated"] is True


async def test_naming_gawain_gawain_wins_not_evil(pool):
    game_id = await _game_ready_for_assassination(pool)
    await pool.execute("SELECT sp_submit_assassination($1,$2,$3)", game_id, 2, [1])
    game = await get_game(pool, game_id)
    assert game["winner"] == "gawain"


async def test_naming_wrong_seat_good_wins(pool):
    game_id = await _game_ready_for_assassination(pool)
    await pool.execute("SELECT sp_submit_assassination($1,$2,$3)", game_id, 2, [3])
    game = await get_game(pool, game_id)
    assert game["winner"] == "good"


async def test_naming_tristan_and_iseult_evil_wins(pool):
    game_id = await _game_ready_for_assassination(pool)
    await pool.execute("SELECT sp_submit_assassination($1,$2,$3)", game_id, 2, [3, 4])
    game = await get_game(pool, game_id)
    assert game["winner"] == "evil"


async def test_naming_gawain_plus_decoy_in_lovers_mode_is_not_gawains_win(pool):
    """Gawain has no win condition in the pair-guess mode, even if he's
    (nonsensically) one of the two named -- only an exact Tristan & Iseult
    match wins that mode, for either side."""
    game_id = await _game_ready_for_assassination(pool)
    await pool.execute("SELECT sp_submit_assassination($1,$2,$3)", game_id, 2, [1, 3])
    game = await get_game(pool, game_id)
    assert game["winner"] == "good"


async def test_passing_good_wins_nobody_flagged(pool):
    game_id = await _game_ready_for_assassination(pool)
    await pool.execute("SELECT sp_submit_assassination($1,$2,$3)", game_id, 2, [])
    game = await get_game(pool, game_id)
    assert game["winner"] == "good"
    assert game["assassination_target"] == []
    flagged = await pool.fetch(
        "SELECT seat FROM game_players WHERE game_id=$1 AND was_assassinated = true", game_id
    )
    assert flagged == []


async def test_only_the_assassin_may_act(pool):
    game_id = await _game_ready_for_assassination(pool)
    with pytest.raises(Exception, match="Only the Assassin"):
        await pool.execute("SELECT sp_submit_assassination($1,$2,$3)", game_id, 0, [1])
