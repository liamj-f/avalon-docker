"""Ad hoc sweep, prompted by a user report that force-resolving a stuck team
vote failed and "maybe it was because that player was a certain character".
sp_force_resolve_team_vote has no role-conditional branch at all (unlike
sp_force_resolve_mission, which special-cases Agravain) -- this empirically
confirms that by disconnecting a seat holding literally every defined role,
one at a time, and checking the force-resolve still cleanly fills their
Approve and resolves the round."""

import pytest

from game.roles import ROLES
from helpers import get_game, start_game

# Every role this build supports, and a player count that can actually seat
# each of them without tripping build_role_list's slot/dependency checks.
# Most fit fine at 5p as a lone special (rest auto-fill to plain
# Loyal Servant/Minion); the ones with real dependencies or a second slot
# need a bigger table or a same-side partner explicitly seated too.
ROLE_SETUPS = {
    "MERLIN": (5, {}),
    "PERCIVAL": (5, {1: ("MERLIN", "good")}),
    "TRISTAN": (5, {}),
    "ISEULT": (5, {}),
    "LOYAL_SERVANT": (5, {}),
    "MORGANA": (5, {1: ("MERLIN", "good"), 2: ("PERCIVAL", "good")}),
    "MORDRED": (5, {1: ("MERLIN", "good")}),
    "OBERON": (5, {}),
    "ASSASSIN": (5, {}),
    "AGRAVAIN": (5, {}),
    "ARTHUR": (5, {}),
    "GAWAIN": (5, {}),
    "LANCELOT": (5, {}),
    "LANCELOT_GOOD": (6, {1: ("LANCELOT_EVIL", "evil")}),
    "LANCELOT_EVIL": (6, {1: ("LANCELOT_GOOD", "good")}),
    "GUINEVERE": (7, {1: ("LANCELOT_GOOD", "good"), 2: ("LANCELOT_EVIL", "evil")}),
    "MINION": (5, {}),
}


@pytest.mark.parametrize("role_id", sorted(ROLE_SETUPS))
async def test_force_resolve_team_vote_works_regardless_of_disconnected_players_role(pool, role_id):
    player_count, extra_roles = ROLE_SETUPS[role_id]
    # Seat 0 is always the one that "disconnects" -- give it the role under
    # test; extra_roles (if any) go on other seats so dependencies are met
    # without colliding with seat 0's assignment.
    roles = {0: (role_id, ROLES[role_id]["team"])}
    roles.update(extra_roles)

    game_id = await start_game(pool, player_count=player_count, roles=roles)
    game = await get_game(pool, game_id)
    team = list(range(min(2, player_count)))
    if 0 not in team:
        team[0] = 0  # make sure the seat under test is actually part of this vote
    await pool.execute("SELECT sp_propose_team($1,$2,$3)", game_id, game["leader_seat"], team)

    # Every OTHER seat votes; seat 0 (holding role_id) is the lone holdout,
    # exactly like a player who disconnected mid-vote.
    for seat in range(1, player_count):
        await pool.execute("SELECT sp_cast_team_vote($1,$2,$3)", game_id, seat, True)

    await pool.execute("SELECT sp_force_resolve_team_vote($1,$2)", game_id, [0])

    game = await get_game(pool, game_id)
    assert game["phase"] == "mission", f"{role_id}: force-resolve did not move the game past team_voting"

    votes = await pool.fetch(
        "SELECT seat, approve FROM team_votes WHERE game_id=$1 AND mission_number=0 AND attempt=0", game_id
    )
    assert len(votes) == player_count, f"{role_id}: expected {player_count} votes recorded, got {len(votes)}"
    seat0_vote = next(v for v in votes if v["seat"] == 0)
    assert seat0_vote["approve"] is True, f"{role_id}: disconnected seat's auto-vote was not Approve"
