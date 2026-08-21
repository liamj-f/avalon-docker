"""Pure-Python unit tests for game/roles.py: dependency validation, the
role-list builder, dealing, and knowledge computation. No database, no
event loop -- these are plain functions, and this is the layer where a
subtle rules bug (Percival's two-candidate case, Mordred actually hidden
from Merlin, Oberon actually isolated) would be easy to get wrong and easy
to test cheaply. Complements tests/test_assassination.py and friends, which
cover the SQL side these feed into via sp_start_game's already-dealt
p_players payload.
"""

import pytest

from game.roles import (
    ROLES,
    GameError,
    assign_roles,
    build_role_list,
    cascade_deselect,
    compute_knowledge,
    default_settings,
    validate_settings,
)

# ---------------------------------------------------------------------------
# default_settings / validate_settings
# ---------------------------------------------------------------------------


def test_default_settings_are_internally_valid():
    """The settings a brand new lobby starts with must themselves pass
    validation at every supported player count -- otherwise a host who
    changes nothing at all couldn't start a game."""
    settings = default_settings()
    for player_count in range(5, 11):
        assert validate_settings(player_count, settings) == []


def test_percival_requires_merlin():
    settings = {**default_settings(), "merlin": False, "percival": True, "morgana": False, "assassin": False}
    errors = validate_settings(5, settings)
    assert any("Percival requires Merlin" in e for e in errors)


def test_morgana_requires_percival():
    settings = {**default_settings(), "percival": False, "morgana": True}
    errors = validate_settings(5, settings)
    assert any("Morgana requires Percival" in e for e in errors)


def test_mordred_requires_merlin():
    settings = {**default_settings(), "merlin": False, "percival": False, "morgana": False, "assassin": False, "mordred": True}
    errors = validate_settings(5, settings)
    assert any("Mordred requires Merlin" in e for e in errors)


def test_guinevere_requires_lancelot_pair():
    settings = {**default_settings(), "guinevere": True}
    errors = validate_settings(7, settings)
    assert any("Guinevere requires the Good & Evil Lancelot pair" in e for e in errors)


def test_lancelot_solo_and_pair_are_mutually_exclusive():
    settings = {**default_settings(), "lancelot": True, "lancelotPair": True}
    errors = validate_settings(7, settings)
    assert any("cannot both be in play" in e for e in errors)


def test_lancelot_and_lancelot_pair_do_not_require_merlin():
    # Unlike Percival/Morgana/Mordred, a Lancelot's Reverse card and the
    # pair's allegiance swap both work with no Merlin at the table --
    # Merlin being in play only changes what he sees, it's not a
    # prerequisite for playing either variant at all.
    settings = {**default_settings(), "merlin": False, "percival": False, "morgana": False, "assassin": False, "lancelot": True}
    assert validate_settings(5, settings) == []

    settings = {**default_settings(), "merlin": False, "percival": False, "morgana": False, "assassin": False, "lancelotPair": True}
    assert validate_settings(7, settings) == []


def test_assassin_needs_a_valid_target():
    settings = {**default_settings(), "merlin": False, "percival": False, "morgana": False, "assassin": True}
    errors = validate_settings(5, settings)
    assert any("Assassin needs at least one valid target" in e for e in errors)


def test_assassin_accepts_gawain_as_sole_target():
    settings = {
        **default_settings(),
        "merlin": False,
        "percival": False,
        "morgana": False,
        "assassin": True,
        "gawain": True,
    }
    assert validate_settings(5, settings) == []


def test_unsupported_player_count_rejected():
    errors = validate_settings(4, default_settings())
    assert any("between 5 and 10" in e for e in errors)
    errors = validate_settings(11, default_settings())
    assert any("between 5 and 10" in e for e in errors)


# ---------------------------------------------------------------------------
# build_role_list
# ---------------------------------------------------------------------------


def test_build_role_list_fills_remaining_slots_with_base_roles():
    settings = {**default_settings(), "merlin": False, "percival": False, "morgana": False, "assassin": False}
    roles = build_role_list(5, settings)
    assert len(roles) == 5
    assert roles.count("MINION") == 2
    assert roles.count("LOYAL_SERVANT") == 3


def test_build_role_list_counts_match_mission_config():
    for player_count in range(5, 11):
        roles = build_role_list(player_count, default_settings())
        good = sum(1 for r in roles if ROLES[r]["team"] == "good")
        evil = sum(1 for r in roles if ROLES[r]["team"] == "evil")
        assert len(roles) == player_count
        # default_settings has merlin/percival/morgana/assassin on -- 2 good
        # specials + 2 evil specials, filled out to the real good/evil split.
        assert good + evil == player_count
        assert "MERLIN" in roles and "PERCIVAL" in roles and "MORGANA" in roles and "ASSASSIN" in roles


def test_build_role_list_raises_when_too_many_evil_specials():
    # 5 players only has 2 Evil slots -- Mordred + Morgana + Assassin is 3.
    settings = {**default_settings(), "mordred": True, "morgana": True, "assassin": True}
    with pytest.raises(GameError, match="Too many Evil special roles"):
        build_role_list(5, settings)


def test_build_role_list_raises_when_too_many_good_specials():
    settings = {
        **default_settings(),
        "arthur": True,
        "gawain": True,
        "tristanIseult": True,
        "lancelot": True,
    }
    with pytest.raises(GameError, match="Too many Good special roles"):
        build_role_list(5, settings)


def test_build_role_list_rejects_unsupported_player_count():
    with pytest.raises(GameError, match="Unsupported player count"):
        build_role_list(4, default_settings())


def test_lancelot_pair_adds_one_to_each_side():
    settings = {**default_settings(), "merlin": True, "percival": False, "morgana": False, "assassin": False, "lancelotPair": True}
    roles = build_role_list(7, settings)
    assert roles.count("LANCELOT_GOOD") == 1
    assert roles.count("LANCELOT_EVIL") == 1


# ---------------------------------------------------------------------------
# assign_roles
# ---------------------------------------------------------------------------


def test_assign_roles_deals_every_seat_exactly_once():
    seats = list(range(7))
    assignments = assign_roles(seats, default_settings())
    assert sorted(a.seat for a in assignments) == seats
    assert len({a.seat for a in assignments}) == len(seats)


def test_assign_roles_team_matches_role_metadata():
    assignments = assign_roles(list(range(8)), default_settings())
    for a in assignments:
        assert a.team == ROLES[a.role_id]["team"]


def test_assign_roles_matches_build_role_list_multiset():
    """Dealing shuffles build_role_list's output -- it must never invent or
    drop a role in the process."""
    # default_settings' merlin/percival/morgana/assassin + mordred/oberon is
    # 4 Evil specials (morgana, assassin, mordred, oberon) -- fits exactly
    # in 10 players' 4 Evil slots.
    settings = {**default_settings(), "mordred": True, "oberon": True}
    seats = list(range(10))
    # build_role_list itself isn't randomized, so calling it again
    # independently of assign_roles' shuffle must give the same multiset.
    assignments = assign_roles(seats, settings)
    dealt = sorted(a.role_id for a in assignments)
    expected = sorted(build_role_list(10, settings))
    assert dealt == expected


# ---------------------------------------------------------------------------
# compute_knowledge
# ---------------------------------------------------------------------------


def _assignment(seats_and_roles):
    from game.roles import RoleAssignment

    return [RoleAssignment(seat=seat, role_id=role_id, team=ROLES[role_id]["team"]) for seat, role_id in seats_and_roles]


def test_merlin_sees_evil_but_not_mordred():
    assignments = _assignment([
        (0, "MERLIN"), (1, "MORDRED"), (2, "MORGANA"), (3, "LOYAL_SERVANT"), (4, "MINION"),
    ])
    knowledge = compute_knowledge(assignments)
    seen_seats = {k["seat"] for k in knowledge[0]}
    assert 1 not in seen_seats  # Mordred hidden
    assert 2 in seen_seats  # Morgana visible
    assert 4 in seen_seats  # plain Minion visible


def test_merlin_sees_lancelot_as_evil_regardless_of_true_team():
    assignments = _assignment([(0, "MERLIN"), (1, "LANCELOT")])
    knowledge = compute_knowledge(assignments)
    seen_seats = {k["seat"] for k in knowledge[0]}
    assert 1 in seen_seats  # Lancelot is Good but still shows as Evil to Merlin


def test_merlin_sees_only_the_evil_half_of_the_lancelot_pair():
    # Unlike solo Lancelot, the swapping pair is not a double red herring --
    # only the genuinely-Evil Lancelot appears Evil to Merlin at the start;
    # the Good one does not additionally show up the way solo Lancelot does.
    assignments = _assignment([(0, "MERLIN"), (1, "LANCELOT_GOOD"), (2, "LANCELOT_EVIL")])
    knowledge = compute_knowledge(assignments)
    seen_seats = {k["seat"] for k in knowledge[0]}
    assert 1 not in seen_seats  # Good-starting Lancelot: not shown as Evil
    assert 2 in seen_seats  # Evil-starting Lancelot: shown as Evil, like any other Evil player


def test_evil_sees_each_other_except_oberon():
    assignments = _assignment([
        (0, "MORGANA"), (1, "MINION"), (2, "OBERON"), (3, "LOYAL_SERVANT"),
    ])
    knowledge = compute_knowledge(assignments)
    morgana_sees = {k["seat"] for k in knowledge[0]}
    minion_sees = {k["seat"] for k in knowledge[1]}
    assert 2 not in morgana_sees  # Oberon hidden from the rest of Evil
    assert 2 not in minion_sees
    assert 1 in morgana_sees  # regular Evil still sees each other
    assert knowledge[2] == []  # Oberon sees nobody


def test_percival_sees_only_merlin_when_morgana_absent():
    assignments = _assignment([(0, "PERCIVAL"), (1, "MERLIN"), (2, "LOYAL_SERVANT")])
    knowledge = compute_knowledge(assignments)
    assert len(knowledge[0]) == 1
    assert knowledge[0][0]["seat"] == 1
    assert knowledge[0][0]["label"] == "Merlin"


def test_percival_sees_two_ambiguous_candidates_when_morgana_present():
    assignments = _assignment([(0, "PERCIVAL"), (1, "MERLIN"), (2, "MORGANA")])
    knowledge = compute_knowledge(assignments)
    seen_seats = {k["seat"] for k in knowledge[0]}
    assert seen_seats == {1, 2}
    assert all("unclear which" in k["label"] for k in knowledge[0])


def test_guinevere_sees_both_lancelots_allegiance_hidden():
    assignments = _assignment([(0, "GUINEVERE"), (1, "LANCELOT_GOOD"), (2, "LANCELOT_EVIL")])
    knowledge = compute_knowledge(assignments)
    seen_seats = {k["seat"] for k in knowledge[0]}
    assert seen_seats == {1, 2}
    assert all("hidden" in k["label"] for k in knowledge[0])


def test_tristan_and_iseult_know_each_other():
    assignments = _assignment([(0, "TRISTAN"), (1, "ISEULT"), (2, "LOYAL_SERVANT")])
    knowledge = compute_knowledge(assignments)
    assert knowledge[0][-1]["seat"] == 1
    assert knowledge[1][-1]["seat"] == 0
    assert knowledge[2] == []


def test_plain_loyal_servant_and_minion_have_no_special_knowledge():
    assignments = _assignment([(0, "LOYAL_SERVANT"), (1, "MINION")])
    knowledge = compute_knowledge(assignments)
    assert knowledge[0] == []


# ---------------------------------------------------------------------------
# cascade_deselect
# ---------------------------------------------------------------------------


def test_cascade_deselect_turns_off_a_direct_dependent():
    settings = {**default_settings(), "merlin": False}  # percival/morgana still True from default_settings
    result = cascade_deselect(settings)
    assert result["percival"] is False


def test_cascade_deselect_unwinds_a_whole_chain_in_one_call():
    # default_settings has merlin/percival/morgana all True -- turning
    # Merlin off should take Percival with it, which should then also take
    # Morgana with it, in the same call.
    settings = {**default_settings(), "merlin": False}
    result = cascade_deselect(settings)
    assert result["percival"] is False
    assert result["morgana"] is False


def test_cascade_deselect_leaves_a_still_satisfied_dependent_alone():
    settings = {**default_settings(), "oberon": True}  # merlin/percival/morgana untouched
    result = cascade_deselect(settings)
    assert result["percival"] is True
    assert result["morgana"] is True


def test_cascade_deselect_never_touches_lancelot_when_merlin_goes_off():
    settings = {**default_settings(), "merlin": False, "lancelot": True}
    result = cascade_deselect(settings)
    assert result["lancelot"] is True


def test_cascade_deselect_respects_assassins_any_of_three_targets():
    # Assassin only needs one of Merlin/Gawain/Tristan & Iseult -- turning
    # Merlin off shouldn't clear it while Gawain is still on.
    settings = {**default_settings(), "merlin": False, "gawain": True, "assassin": True}
    result = cascade_deselect(settings)
    assert result["assassin"] is True

    # But with none of the three left, it does clear.
    settings = {**default_settings(), "merlin": False, "percival": False, "morgana": False, "assassin": True}
    result = cascade_deselect(settings)
    assert result["assassin"] is False


def test_cascade_deselect_clears_guinevere_when_the_lancelot_pair_goes_off():
    settings = {**default_settings(), "lancelotPair": True, "guinevere": True}
    result = cascade_deselect(settings)
    assert result["guinevere"] is True  # pair still on -- untouched

    settings = {**default_settings(), "lancelotPair": False, "guinevere": True}
    result = cascade_deselect(settings)
    assert result["guinevere"] is False
