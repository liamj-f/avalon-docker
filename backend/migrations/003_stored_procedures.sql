-- The whole gameplay state machine, as stored procedures. The backend calls
-- these over a normal SQL connection; nothing stops you from calling them
-- yourself from `psql` to see how the app reacts (every mutating function
-- ends with pg_notify, which the backend is LISTENing for). See README for
-- a worked example.
--
-- Convention: read-modify-write happens under `SELECT ... FOR UPDATE` on the
-- games row so two simultaneous calls for the same game (e.g. two players
-- voting at the same instant) serialize instead of racing. Invalid moves
-- (wrong phase, wrong seat, duplicate vote, ...) raise a plain exception;
-- the backend surfaces err.message directly to the player as a toast.

-- Next seat clockwise from p_current in the fixed turn order p_seat_order.
CREATE OR REPLACE FUNCTION _next_seat(p_seat_order SMALLINT[], p_current SMALLINT)
RETURNS SMALLINT AS $$
  SELECT p_seat_order[(array_position(p_seat_order, p_current) % array_length(p_seat_order, 1)) + 1];
$$ LANGUAGE sql IMMUTABLE;

-- Deals a game into existence. Role assignment/shuffling happens in the
-- Node app (backend/src/game/roles.js) — it's already unit-tested there —
-- this just persists the result and sets up initial turn state.
CREATE OR REPLACE FUNCTION sp_start_game(
    p_room_code VARCHAR,
    p_settings JSONB,
    p_seat_order INT[],
    p_leader_seat INT,
    p_lady_holder_seat INT,   -- NULL if Lady of the Lake is off
    p_excalibur_holder_seat INT, -- NULL if Excalibur is off
    p_players JSONB                -- [{seat, displayName, roleId, team, knowledge}, ...]
) RETURNS UUID AS $$
DECLARE
    new_game_id UUID;
    p JSONB;
BEGIN
    INSERT INTO games (
        room_code, player_count, roles_config, settings, seat_order, leader_seat,
        lady_holder_seat, excalibur_holder_seat, phase, started_at
    ) VALUES (
        p_room_code, array_length(p_seat_order, 1), p_settings, p_settings, p_seat_order, p_leader_seat,
        p_lady_holder_seat, p_excalibur_holder_seat, 'team_building', now()
    ) RETURNING id INTO new_game_id;

    FOR p IN SELECT * FROM jsonb_array_elements(p_players) LOOP
        INSERT INTO game_players (game_id, seat, display_name, role, team, knowledge)
        VALUES (new_game_id, (p->>'seat')::SMALLINT, p->>'displayName', p->>'roleId', p->>'team', p->'knowledge');
    END LOOP;

    PERFORM pg_notify('avalon_game_updates', new_game_id::text);
    RETURN new_game_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_propose_team(p_game_id UUID, p_leader_seat INT, p_team INT[])
RETURNS VOID AS $$
DECLARE
    g games%ROWTYPE;
    mc mission_config%ROWTYPE;
    expected_size SMALLINT;
BEGIN
    SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Game not found.'; END IF;
    IF g.phase <> 'team_building' THEN RAISE EXCEPTION 'Not in the team-building phase.'; END IF;
    IF g.leader_seat <> p_leader_seat THEN RAISE EXCEPTION 'Only the current leader can propose a team.'; END IF;

    SELECT * INTO mc FROM mission_config WHERE player_count = g.player_count;
    expected_size := mc.team_sizes[g.mission_number + 1]; -- SQL arrays are 1-indexed

    IF array_length(p_team, 1) IS DISTINCT FROM expected_size
       OR (SELECT COUNT(DISTINCT x) FROM unnest(p_team) x) <> expected_size THEN
        RAISE EXCEPTION 'The team must have exactly % distinct players.', expected_size;
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(p_team) s WHERE s <> ALL(g.seat_order)) THEN
        RAISE EXCEPTION 'Team includes an unknown seat.';
    END IF;

    UPDATE games SET proposed_team = p_team, phase = 'team_voting' WHERE id = p_game_id;
    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_cast_team_vote(p_game_id UUID, p_seat INT, p_approve BOOLEAN)
RETURNS VOID AS $$
DECLARE
    g games%ROWTYPE;
    votes_in INT;
    approvals INT;
    approved BOOLEAN;
BEGIN
    SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Game not found.'; END IF;
    IF g.phase <> 'team_voting' THEN RAISE EXCEPTION 'Not in the voting phase.'; END IF;
    IF p_seat <> ALL(g.seat_order) THEN RAISE EXCEPTION 'Unknown seat.'; END IF;

    BEGIN
        INSERT INTO team_votes (game_id, mission_number, attempt, seat, approve)
        VALUES (p_game_id, g.mission_number, g.rejection_count, p_seat, p_approve);
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'You already voted.';
    END;

    SELECT COUNT(*) INTO votes_in FROM team_votes
        WHERE game_id = p_game_id AND mission_number = g.mission_number AND attempt = g.rejection_count;

    IF votes_in < array_length(g.seat_order, 1) THEN
        PERFORM pg_notify('avalon_game_updates', p_game_id::text);
        RETURN;
    END IF;

    SELECT COUNT(*) FILTER (WHERE approve) INTO approvals FROM team_votes
        WHERE game_id = p_game_id AND mission_number = g.mission_number AND attempt = g.rejection_count;
    approved := approvals * 2 > array_length(g.seat_order, 1);

    IF approved THEN
        UPDATE games SET phase = 'mission' WHERE id = p_game_id;
    ELSIF g.rejection_count + 1 >= 5 THEN
        -- Five rejected proposals in a row: Evil wins outright, no quest is ever failed by vote alone.
        UPDATE games SET phase = 'game_over', winner = 'evil', win_reason = 'vote_track',
                          rejection_count = rejection_count + 1, ended_at = now(), proposed_team = NULL
            WHERE id = p_game_id;
    ELSE
        UPDATE games SET phase = 'team_building',
                          rejection_count = rejection_count + 1,
                          leader_seat = _next_seat(g.seat_order, g.leader_seat),
                          proposed_team = NULL
            WHERE id = p_game_id;
    END IF;

    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_cast_mission_card(p_game_id UUID, p_seat INT, p_success BOOLEAN)
RETURNS VOID AS $$
DECLARE
    g games%ROWTYPE;
    gp game_players%ROWTYPE;
    cards_in INT;
    fail_count INT;
BEGIN
    SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Game not found.'; END IF;
    IF g.phase <> 'mission' THEN RAISE EXCEPTION 'Not in the mission phase.'; END IF;
    IF p_seat <> ALL(g.proposed_team) THEN RAISE EXCEPTION 'You are not on this mission.'; END IF;

    SELECT * INTO gp FROM game_players WHERE game_id = p_game_id AND seat = p_seat;
    IF gp.team = 'good' AND p_success = false THEN
        RAISE EXCEPTION 'Good players must play Success.';
    END IF;

    BEGIN
        INSERT INTO mission_cards (game_id, mission_number, seat, success)
        VALUES (p_game_id, g.mission_number, p_seat, p_success);
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'You already played a card on this mission.';
    END;

    SELECT COUNT(*) INTO cards_in FROM mission_cards
        WHERE game_id = p_game_id AND mission_number = g.mission_number;
    IF cards_in < array_length(g.proposed_team, 1) THEN
        PERFORM pg_notify('avalon_game_updates', p_game_id::text);
        RETURN;
    END IF;

    SELECT COUNT(*) FILTER (WHERE NOT success) INTO fail_count
        FROM mission_cards WHERE game_id = p_game_id AND mission_number = g.mission_number;

    IF (g.settings->>'excalibur')::boolean AND g.excalibur_holder_seat IS NOT NULL
       AND NOT g.excalibur_used AND fail_count >= 1 THEN
        -- Hand the decision to the Excalibur holder instead of resolving immediately.
        UPDATE games SET phase = 'excalibur_decision', pending_fail_count = fail_count WHERE id = p_game_id;
    ELSE
        PERFORM _resolve_mission(p_game_id, fail_count);
    END IF;

    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_excalibur_decision(p_game_id UUID, p_seat INT, p_use BOOLEAN)
RETURNS VOID AS $$
DECLARE
    g games%ROWTYPE;
    final_fail_count INT;
BEGIN
    SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Game not found.'; END IF;
    IF g.phase <> 'excalibur_decision' THEN RAISE EXCEPTION 'Not in the Excalibur decision phase.'; END IF;
    IF g.excalibur_holder_seat <> p_seat THEN RAISE EXCEPTION 'Only the Excalibur holder may decide this.'; END IF;

    final_fail_count := g.pending_fail_count - (CASE WHEN p_use THEN 1 ELSE 0 END);

    INSERT INTO excalibur_events (game_id, mission_number, holder_seat, used, fail_count_before, fail_count_after)
    VALUES (p_game_id, g.mission_number, p_seat, p_use, g.pending_fail_count, final_fail_count);

    -- Excalibur is a single legendary use per game: spent once, gone for good.
    UPDATE games SET excalibur_used = excalibur_used OR p_use,
                      excalibur_holder_seat = CASE WHEN p_use THEN NULL ELSE excalibur_holder_seat END,
                      pending_fail_count = NULL
        WHERE id = p_game_id;

    PERFORM _resolve_mission(p_game_id, final_fail_count);
    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
END;
$$ LANGUAGE plpgsql;

-- Shared tail end of a mission: record the result, check both win
-- conditions, and figure out the next phase (Lady of the Lake, the
-- assassination, or straight back to team-building).
CREATE OR REPLACE FUNCTION _resolve_mission(p_game_id UUID, p_fail_count INT)
RETURNS VOID AS $$
DECLARE
    g games%ROWTYPE;
    mc mission_config%ROWTYPE;
    v_required INT;
    v_team_size INT;
    v_result VARCHAR(10); -- named to avoid shadowing/ambiguity with game_missions.result below
    successes INT;
    fails INT;
    next_phase VARCHAR(24);
BEGIN
    SELECT * INTO g FROM games WHERE id = p_game_id;
    SELECT * INTO mc FROM mission_config WHERE player_count = g.player_count;
    v_required := mc.fails_required[g.mission_number + 1];
    v_team_size := mc.team_sizes[g.mission_number + 1];
    v_result := CASE WHEN p_fail_count >= v_required THEN 'fail' ELSE 'success' END;

    INSERT INTO game_missions (game_id, mission_number, team_size, fails_required, team_seats, result, fail_count)
    VALUES (p_game_id, g.mission_number, v_team_size, v_required, to_jsonb(g.proposed_team), v_result, p_fail_count);

    SELECT COUNT(*) FILTER (WHERE result = 'success'), COUNT(*) FILTER (WHERE result = 'fail')
        INTO successes, fails
        FROM game_missions WHERE game_id = p_game_id;

    IF fails >= 3 THEN
        -- Three failed quests: Evil wins outright, no assassination needed.
        UPDATE games SET phase = 'game_over', winner = 'evil', win_reason = 'missions',
                          ended_at = now(), proposed_team = NULL
            WHERE id = p_game_id;
        RETURN;
    END IF;

    IF successes >= 3 THEN
        IF (g.settings->>'assassin')::boolean THEN
            UPDATE games SET phase = 'assassination', proposed_team = NULL WHERE id = p_game_id;
        ELSE
            UPDATE games SET phase = 'game_over', winner = 'good', win_reason = 'missions',
                              ended_at = now(), proposed_team = NULL
                WHERE id = p_game_id;
        END IF;
        RETURN;
    END IF;

    -- Lady of the Lake activates after missions 2, 3 and 4 (mission_number 1..3, 0-indexed).
    IF (g.settings->>'ladyOfLake')::boolean AND g.mission_number BETWEEN 1 AND 3 AND g.lady_holder_seat IS NOT NULL THEN
        next_phase := 'lady_of_lake';
    ELSE
        next_phase := 'team_building';
    END IF;

    UPDATE games SET phase = next_phase,
                      mission_number = g.mission_number + 1,
                      leader_seat = _next_seat(g.seat_order, g.leader_seat),
                      rejection_count = 0,
                      proposed_team = NULL
        WHERE id = p_game_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_use_lady_of_lake(p_game_id UUID, p_seat INT, p_target_seat INT)
RETURNS VOID AS $$
DECLARE
    g games%ROWTYPE;
    target_team VARCHAR(10);
BEGIN
    SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Game not found.'; END IF;
    IF g.phase <> 'lady_of_lake' THEN RAISE EXCEPTION 'Not in the Lady of the Lake phase.'; END IF;
    IF g.lady_holder_seat <> p_seat THEN RAISE EXCEPTION 'Only the current Lady of the Lake holder may use it.'; END IF;
    IF p_target_seat = p_seat OR p_target_seat = ANY(g.lady_history) THEN
        RAISE EXCEPTION 'Choose someone who has not already held the Lady of the Lake.';
    END IF;
    IF p_target_seat <> ALL(g.seat_order) THEN RAISE EXCEPTION 'Invalid target.'; END IF;

    SELECT team INTO target_team FROM game_players WHERE game_id = p_game_id AND seat = p_target_seat;

    INSERT INTO lady_of_lake_events (game_id, mission_number, holder_seat, target_seat, revealed_team)
    VALUES (p_game_id, g.mission_number, p_seat, p_target_seat, target_team);

    UPDATE games SET phase = 'team_building',
                      lady_holder_seat = p_target_seat,
                      lady_history = array_append(g.lady_history, p_seat)
        WHERE id = p_game_id;

    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_submit_assassination(p_game_id UUID, p_seat INT, p_target_seat INT)
RETURNS VOID AS $$
DECLARE
    g games%ROWTYPE;
    assassin_seat SMALLINT;
    merlin_seat SMALLINT;
    hit_merlin BOOLEAN;
BEGIN
    SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Game not found.'; END IF;
    IF g.phase <> 'assassination' THEN RAISE EXCEPTION 'Not in the assassination phase.'; END IF;

    SELECT seat INTO assassin_seat FROM game_players WHERE game_id = p_game_id AND role = 'ASSASSIN';
    IF assassin_seat IS NULL OR assassin_seat <> p_seat THEN
        RAISE EXCEPTION 'Only the Assassin may name a target.';
    END IF;
    IF p_target_seat <> ALL(g.seat_order) THEN RAISE EXCEPTION 'Invalid target.'; END IF;

    SELECT seat INTO merlin_seat FROM game_players WHERE game_id = p_game_id AND role = 'MERLIN';
    hit_merlin := merlin_seat IS NOT NULL AND merlin_seat = p_target_seat;

    UPDATE game_players SET was_assassinated = true WHERE game_id = p_game_id AND seat = p_target_seat;
    UPDATE games SET phase = 'game_over',
                      assassination_target = p_target_seat,
                      winner = CASE WHEN hit_merlin THEN 'evil' ELSE 'good' END,
                      win_reason = 'assassination',
                      ended_at = now()
        WHERE id = p_game_id;

    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
END;
$$ LANGUAGE plpgsql;
