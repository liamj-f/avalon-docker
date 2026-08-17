"""If the `pool` fixture itself didn't fail, the migrations already applied
cleanly to a brand new database -- that's most of what this file is really
testing. These add a few explicit sanity checks on top: the tables and
stored procedures the rest of the suite (and the real app) depend on
actually exist, under the names game_db.py expects.
"""

EXPECTED_TABLES = {
    "mission_config",
    "games",
    "game_players",
    "game_missions",
    "team_proposals",
    "team_votes",
    "mission_cards",
    "lady_of_lake_events",
    "excalibur_events",
    "schema_migrations",
}

EXPECTED_FUNCTIONS = {
    "sp_start_game",
    "sp_propose_team",
    "sp_cast_team_vote",
    "sp_force_resolve_team_vote",
    "sp_cast_mission_card",
    "sp_force_resolve_mission",
    "sp_excalibur_view",
    "sp_excalibur_decision",
    "sp_force_decline_excalibur",
    "sp_use_lady_of_lake",
    "sp_force_resolve_lady_of_lake",
    "sp_submit_assassination",
    "sp_force_pass_assassination",
    "sp_reveal_arthur",
    "sp_force_advance_leader",
}


async def test_expected_tables_exist(pool):
    rows = await pool.fetch(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    )
    actual = {r["table_name"] for r in rows}
    missing = EXPECTED_TABLES - actual
    assert not missing, f"migrations didn't create expected table(s): {missing}"


async def test_expected_functions_exist(pool):
    rows = await pool.fetch(
        "SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace"
    )
    actual = {r["proname"] for r in rows}
    missing = EXPECTED_FUNCTIONS - actual
    assert not missing, f"migrations didn't create expected function(s): {missing}"


async def test_no_orphaned_function_overloads(pool):
    """Every one of *our* stored procedures (sp_* and the private
    _-prefixed helpers -- excludes pgcrypto's own functions, which are
    legitimately overloaded by design) should have exactly one signature.
    More than one means a signature changed without the old one being
    dropped (the exact mistake the 001-008 -> 001+002 consolidation quietly
    cleaned up; see the commit that did it). A duplicate here would mean a
    future edit reintroduced the same mistake."""
    rows = await pool.fetch(
        r"""
        SELECT proname, COUNT(*) AS overloads
        FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND (proname LIKE 'sp\_%' OR proname LIKE '\_%')
        GROUP BY proname
        HAVING COUNT(*) > 1
        """
    )
    assert not rows, f"unexpected duplicate function signatures: {[r['proname'] for r in rows]}"


async def test_mission_config_seed_data(pool):
    row = await pool.fetchrow("SELECT * FROM mission_config WHERE player_count = 5")
    assert row["team_sizes"] == [2, 3, 2, 3, 3]
    assert row["fails_required"] == [1, 1, 1, 1, 1]
    assert row["good_count"] == 3
    assert row["evil_count"] == 2
