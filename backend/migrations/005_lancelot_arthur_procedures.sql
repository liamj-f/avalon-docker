-- Updates the stored procedures for Agravain, Arthur, and both Lancelot
-- modes. CREATE OR REPLACE only truly replaces a function when its argument
-- list is unchanged (that's why _resolve_mission and sp_reveal_arthur below
-- read as a clean diff against 003) — sp_start_game and sp_cast_mission_card
-- both gain a new parameter, which Postgres treats as a distinct overload
-- rather than a replacement, so their old-arity versions from 003 are
-- explicitly dropped first to avoid leaving a stale, un-Agravain-aware
-- back door into sp_cast_mission_card sitting in the schema.

DROP FUNCTION IF EXISTS sp_start_game(VARCHAR, JSONB, INT[], INT, INT, INT, JSONB);
DROP FUNCTION IF EXISTS sp_cast_mission_card(UUID, INT, BOOLEAN);

CREATE OR REPLACE FUNCTION sp_start_game(
    p_room_code VARCHAR,
    p_settings JSONB,
    p_seat_order INT[],
    p_leader_seat INT,
    p_lady_holder_seat INT,      -- NULL if Lady of the Lake is off
    p_excalibur_holder_seat INT, -- NULL if Excalibur is off
    p_swap_mission_number INT,   -- NULL unless the paired Lancelots are in play
    p_players JSONB              -- [{seat, displayName, roleId, team, knowledge}, ...]
) RETURNS UUID AS $$
DECLARE
    new_game_id UUID;
    p JSONB;
BEGIN
    INSERT INTO games (
        room_code, player_count, roles_config, settings, seat_order, leader_seat,
        lady_holder_seat, excalibur_holder_seat, swap_mission_number, phase, started_at
    ) VALUES (
        p_room_code, array_length(p_seat_order, 1), p_settings, p_settings, p_seat_order, p_leader_seat,
        p_lady_holder_seat, p_excalibur_holder_seat, p_swap_mission_number, 'team_building', now()
    ) RETURNING id INTO new_game_id;

    FOR p IN SELECT * FROM jsonb_array_elements(p_players) LOOP
        INSERT INTO game_players (game_id, seat, display_name, role, team, knowledge)
        VALUES (new_game_id, (p->>'seat')::SMALLINT, p->>'displayName', p->>'roleId', p->>'team', p->'knowledge');
    END LOOP;

    PERFORM pg_notify('avalon_game_updates', new_game_id::text);
    RETURN new_game_id;
END;
$$ LANGUAGE plpgsql;

-- p_reverse: only Lancelot (solo) may pass true, and only once per game —
-- see the validation block below. Playing Reverse replaces Success/Fail
-- entirely; p_success is ignored (but still required by the signature) when
-- p_reverse is true.
CREATE OR REPLACE FUNCTION sp_cast_mission_card(p_game_id UUID, p_seat INT, p_success BOOLEAN, p_reverse BOOLEAN DEFAULT false)
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

    IF p_reverse THEN
        IF gp.role <> 'LANCELOT' THEN RAISE EXCEPTION 'Only Lancelot may play the Reverse card.'; END IF;
        IF g.lancelot_reverse_used THEN RAISE EXCEPTION 'The Reverse card has already been used.'; END IF;
    ELSE
        IF gp.team = 'good' AND p_success = false THEN
            RAISE EXCEPTION 'Good players must play Success.';
        END IF;
        IF gp.role = 'AGRAVAIN' AND p_success = true THEN
            RAISE EXCEPTION 'Agravain must play Fail on every quest.';
        END IF;
    END IF;

    BEGIN
        INSERT INTO mission_cards (game_id, mission_number, seat, success, reversed)
        VALUES (p_game_id, g.mission_number, p_seat, CASE WHEN p_reverse THEN true ELSE p_success END, p_reverse);
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'You already played a card on this mission.';
    END;

    IF p_reverse THEN
        UPDATE games SET lancelot_reverse_used = true WHERE id = p_game_id;
    END IF;

    SELECT COUNT(*) INTO cards_in FROM mission_cards
        WHERE game_id = p_game_id AND mission_number = g.mission_number;
    IF cards_in < array_length(g.proposed_team, 1) THEN
        PERFORM pg_notify('avalon_game_updates', p_game_id::text);
        RETURN;
    END IF;

    -- The Reverse card replaces its player's vote entirely — it never
    -- itself counts toward the fail tally, only toward flipping the
    -- outcome afterward (handled in _resolve_mission).
    SELECT COUNT(*) FILTER (WHERE NOT success AND NOT reversed) INTO fail_count
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
    IF NOT g.lancelots_swapped AND g.swap_mission_number IS NOT NULL AND g.mission_number = g.swap_mission_number THEN
        UPDATE game_players SET team = CASE role WHEN 'LANCELOT_GOOD' THEN 'evil' WHEN 'LANCELOT_EVIL' THEN 'good' ELSE team END
            WHERE game_id = p_game_id AND role IN ('LANCELOT_GOOD', 'LANCELOT_EVIL');
        UPDATE games SET lancelots_swapped = true WHERE id = p_game_id;
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

-- Arthur's self-reveal: available any time from the moment 2 quests have
-- failed until the game ends. Purely informational (marks game_players.
-- revealed), doesn't touch phase/turn order.
CREATE OR REPLACE FUNCTION sp_reveal_arthur(p_game_id UUID, p_seat INT)
RETURNS VOID AS $$
DECLARE
    g games%ROWTYPE;
    gp game_players%ROWTYPE;
    fails INT;
BEGIN
    SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Game not found.'; END IF;
    IF g.phase = 'game_over' THEN RAISE EXCEPTION 'The game has already ended.'; END IF;

    SELECT * INTO gp FROM game_players WHERE game_id = p_game_id AND seat = p_seat;
    IF gp.role IS NULL OR gp.role <> 'ARTHUR' THEN RAISE EXCEPTION 'Only Arthur may reveal themselves.'; END IF;
    IF gp.revealed THEN RAISE EXCEPTION 'Arthur has already revealed themselves.'; END IF;

    SELECT COUNT(*) FILTER (WHERE result = 'fail') INTO fails FROM game_missions WHERE game_id = p_game_id;
    IF fails < 2 THEN RAISE EXCEPTION 'Arthur can only reveal after 2 quests have failed.'; END IF;

    UPDATE game_players SET revealed = true, revealed_at = now() WHERE game_id = p_game_id AND seat = p_seat;
    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
END;
$$ LANGUAGE plpgsql;
