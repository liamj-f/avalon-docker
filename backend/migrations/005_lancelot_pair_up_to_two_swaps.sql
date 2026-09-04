-- The paired Lancelots' allegiance swap was hardcoded to happen exactly
-- once: games.swap_mission_number held a single mission, and
-- lancelots_swapped was a plain boolean. Per an explicit rule change, the
-- swap is still random and secret, but can now land on the same mission
-- schedule twice (so the pair swaps, then swaps back) -- never zero times,
-- never three or more. games.swap_mission_number/lancelots_swapped are
-- left in place, unused (same as pending_fail_count above them) -- nothing
-- reads them anymore, but dropping them isn't worth the risk for a column
-- with no cost to leaving alone.
ALTER TABLE games ADD COLUMN swap_mission_numbers SMALLINT[];
ALTER TABLE games ADD COLUMN lancelots_swap_count SMALLINT NOT NULL DEFAULT 0;

-- Signature change (INT -> INT[] for the swap-schedule param) needs an
-- explicit drop first -- CREATE OR REPLACE can't change a function's
-- parameter types, only its body (see test_no_orphaned_function_overloads).
DROP FUNCTION IF EXISTS sp_start_game(VARCHAR, JSONB, INT[], INT, INT, INT, INT, JSONB);

CREATE OR REPLACE FUNCTION sp_start_game(
    p_room_code VARCHAR,
    p_settings JSONB,
    p_seat_order INT[],
    p_leader_seat INT,
    p_lady_holder_seat INT,      -- NULL if Lady of the Lake is off
    p_excalibur_holder_seat INT, -- NULL if Excalibur is off
    p_swap_mission_numbers INT[], -- NULL unless the paired Lancelots are in play; 1 or 2 distinct mission numbers
    p_players JSONB              -- [{seat, displayName, roleId, team, knowledge}, ...]
) RETURNS UUID AS $$
DECLARE
    new_game_id UUID;
    p JSONB;
BEGIN
    INSERT INTO games (
        room_code, player_count, settings, seat_order, leader_seat,
        lady_holder_seat, excalibur_holder_seat, swap_mission_numbers, phase, started_at
    ) VALUES (
        p_room_code, array_length(p_seat_order, 1), p_settings, p_seat_order, p_leader_seat,
        p_lady_holder_seat, p_excalibur_holder_seat, p_swap_mission_numbers, 'team_building', now()
    ) RETURNING id INTO new_game_id;

    FOR p IN SELECT * FROM jsonb_array_elements(p_players) LOOP
        INSERT INTO game_players (game_id, seat, display_name, role, team, knowledge)
        VALUES (new_game_id, (p->>'seat')::SMALLINT, p->>'displayName', p->>'roleId', p->>'team', p->'knowledge');
    END LOOP;

    PERFORM pg_notify('avalon_game_updates', new_game_id::text);
    RETURN new_game_id;
END;
$$ LANGUAGE plpgsql;

-- Same body as before except the paired-Lancelots block: instead of a
-- single scheduled mission gated by a boolean, every mission number in
-- swap_mission_numbers (1 or 2 of them, chosen once at deal time in
-- rooms.py -- see there) triggers another swap when it's reached. Since
-- mission_number only ever increases and each value is visited once per
-- game, no extra "already swapped this mission" guard is needed -- the
-- array membership check alone can't double-fire. A second swap simply
-- flips the pair straight back, exactly as if the first had never
-- happened, which is the point: "more than once but not more than twice."
CREATE OR REPLACE FUNCTION _resolve_mission(p_game_id UUID, p_fail_count INT)
RETURNS VOID AS $$
DECLARE
    g games%ROWTYPE;
    mc mission_config%ROWTYPE;
    v_required INT;
    v_team_size INT;
    v_result VARCHAR(10); -- named to avoid shadowing/ambiguity with game_missions.result below
    v_was_reversed BOOLEAN;
    successes INT;
    fails INT;
    next_phase VARCHAR(24);
BEGIN
    SELECT * INTO g FROM games WHERE id = p_game_id;
    SELECT * INTO mc FROM mission_config WHERE player_count = g.player_count;
    v_required := mc.fails_required[g.mission_number + 1];
    v_team_size := mc.team_sizes[g.mission_number + 1];
    v_result := CASE WHEN p_fail_count >= v_required THEN 'fail' ELSE 'success' END;

    SELECT bool_or(reversed) INTO v_was_reversed
        FROM mission_cards WHERE game_id = p_game_id AND mission_number = g.mission_number;
    IF v_was_reversed THEN
        v_result := CASE WHEN v_result = 'success' THEN 'fail' ELSE 'success' END;
    END IF;

    INSERT INTO game_missions (game_id, mission_number, team_size, fails_required, team_seats, result, fail_count)
    VALUES (p_game_id, g.mission_number, v_team_size, v_required, to_jsonb(g.proposed_team), v_result, p_fail_count);

    -- Paired Lancelots: an automatic, secretly-predetermined swap, unrelated
    -- to any player choice. Applies as soon as its scheduled mission
    -- finishes, win or lose, so it can even land on the deciding mission.
    -- Up to two scheduled missions now (see migration note above) -- each
    -- one reached flips the pair again. Toggles off the CURRENT team, not
    -- a fixed assignment keyed by role -- a role-keyed assignment (e.g.
    -- "LANCELOT_GOOD always becomes evil") would correctly apply the first
    -- swap but then be a no-op on the second, since by then LANCELOT_GOOD's
    -- row is already evil; toggling makes a second landed swap actually
    -- flip the pair back, matching "can happen more than once."
    IF g.swap_mission_numbers IS NOT NULL AND g.mission_number = ANY(g.swap_mission_numbers) THEN
        UPDATE game_players SET team = CASE team WHEN 'good' THEN 'evil' WHEN 'evil' THEN 'good' ELSE team END
            WHERE game_id = p_game_id AND role IN ('LANCELOT_GOOD', 'LANCELOT_EVIL');
        UPDATE games SET lancelots_swap_count = lancelots_swap_count + 1 WHERE id = p_game_id;
    END IF;

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
