-- Correction to migration 002: Excalibur was built as single-use for the
-- whole game (spend it once, gone for good -- games.excalibur_used). Per
-- an explicit rule correction, that's wrong: Excalibur is available again
-- every round, the same as every other quest -- there is no game-wide
-- limit at all, only the existing per-quest ones (one view, one decision,
-- never on your own card). games.excalibur_used is left in place, just no
-- longer read or written by anything below -- same leave-it-alone
-- treatment as pending_fail_count/swap_mission_number elsewhere in these
-- migrations.
CREATE OR REPLACE FUNCTION sp_propose_team(
    p_game_id UUID, p_leader_seat INT, p_team INT[],
    p_excalibur_seat INT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
    g games%ROWTYPE;
    mc mission_config%ROWTYPE;
    expected_size SMALLINT;
    excalibur_active BOOLEAN;
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

    excalibur_active := (g.settings->>'excalibur')::boolean;
    IF excalibur_active THEN
        IF p_excalibur_seat IS NULL THEN
            RAISE EXCEPTION 'Choose who holds Excalibur for this quest.';
        END IF;
        IF p_excalibur_seat = p_leader_seat THEN
            RAISE EXCEPTION 'The leader cannot hold Excalibur themselves -- pick someone else on the team.';
        END IF;
        IF p_excalibur_seat <> ALL(p_team) THEN
            RAISE EXCEPTION 'Excalibur must go to a player on the proposed team.';
        END IF;
    ELSE
        p_excalibur_seat := NULL;
    END IF;

    INSERT INTO team_proposals (game_id, mission_number, attempt, leader_seat, team_seats, excalibur_seat)
    VALUES (p_game_id, g.mission_number, g.rejection_count, p_leader_seat, to_jsonb(p_team), p_excalibur_seat);

    UPDATE games SET proposed_team = p_team, phase = 'team_voting', excalibur_holder_seat = p_excalibur_seat
        WHERE id = p_game_id;
    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
END;
$$ LANGUAGE plpgsql;

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

    -- Excalibur looks at *every* quest (not just ones that already came
    -- back with a Fail) as long as it's assigned this round -- available
    -- every round, no game-wide limit (see migration note above).
    IF (g.settings->>'excalibur')::boolean AND g.excalibur_holder_seat IS NOT NULL THEN
        UPDATE games SET phase = 'excalibur_decision' WHERE id = p_game_id;
    ELSE
        SELECT COUNT(*) FILTER (WHERE NOT success AND NOT reversed) INTO fail_count
            FROM mission_cards WHERE game_id = p_game_id AND mission_number = g.mission_number;
        PERFORM _resolve_mission(p_game_id, fail_count);
    END IF;

    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_excalibur_decision(
    p_game_id UUID, p_seat INT, p_use BOOLEAN,
    p_new_success BOOLEAN DEFAULT NULL -- only consulted when the viewed card is Lancelot's Reverse card
) RETURNS VOID AS $$
DECLARE
    g games%ROWTYPE;
    target_card mission_cards%ROWTYPE;
    v_new_success BOOLEAN;
    fail_count INT;
BEGIN
    SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Game not found.'; END IF;
    IF g.phase <> 'excalibur_decision' THEN RAISE EXCEPTION 'Not in the Excalibur decision phase.'; END IF;
    IF g.excalibur_holder_seat <> p_seat THEN RAISE EXCEPTION 'Only the Excalibur holder may decide this.'; END IF;
    IF g.excalibur_viewing_seat IS NULL THEN RAISE EXCEPTION 'View a card before deciding.'; END IF;

    SELECT * INTO target_card FROM mission_cards
        WHERE game_id = p_game_id AND mission_number = g.mission_number AND seat = g.excalibur_viewing_seat;

    IF p_use THEN
        IF target_card.reversed THEN
            IF p_new_success IS NULL THEN
                RAISE EXCEPTION 'Choose Success or Fail for the Reverse card.';
            END IF;
            v_new_success := p_new_success;
        ELSE
            v_new_success := NOT target_card.success;
        END IF;

        UPDATE mission_cards SET success = v_new_success, reversed = false
            WHERE game_id = p_game_id AND mission_number = g.mission_number AND seat = g.excalibur_viewing_seat;
    END IF;

    -- original_success/original_reversed are stored whether or not it was
    -- used -- the holder saw the real card either way, and the target
    -- already knew it (they're the one who played it).
    INSERT INTO excalibur_events (
        game_id, mission_number, holder_seat, used, target_seat,
        original_success, original_reversed, new_success
    ) VALUES (
        p_game_id, g.mission_number, p_seat, p_use, g.excalibur_viewing_seat,
        target_card.success, target_card.reversed, CASE WHEN p_use THEN v_new_success ELSE NULL END
    );

    -- Reusable every round -- clears this quest's holder/viewing state
    -- (the *next* quest's leader assigns it fresh, same as before) but no
    -- longer touches games.excalibur_used; there's nothing left to spend.
    UPDATE games SET excalibur_holder_seat = NULL,
                      excalibur_viewing_seat = NULL
        WHERE id = p_game_id;

    SELECT COUNT(*) FILTER (WHERE NOT success AND NOT reversed) INTO fail_count
        FROM mission_cards WHERE game_id = p_game_id AND mission_number = g.mission_number;
    PERFORM _resolve_mission(p_game_id, fail_count);
    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_force_resolve_mission(p_game_id UUID, p_disconnected_seats INT[])
RETURNS VOID AS $$
DECLARE
    g games%ROWTYPE;
    v_seat INT;
    v_role VARCHAR(20);
    cards_in INT;
    fail_count INT;
BEGIN
    SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Game not found.'; END IF;
    IF g.phase <> 'mission' THEN RAISE EXCEPTION 'Not currently waiting on mission cards.'; END IF;

    FOREACH v_seat IN ARRAY g.proposed_team LOOP
        IF v_seat = ANY(p_disconnected_seats)
           AND NOT EXISTS (
               SELECT 1 FROM mission_cards mc
               WHERE mc.game_id = p_game_id AND mc.mission_number = g.mission_number AND mc.seat = v_seat
           ) THEN
            SELECT role INTO v_role FROM game_players WHERE game_id = p_game_id AND seat = v_seat;
            INSERT INTO mission_cards (game_id, mission_number, seat, success, reversed)
            VALUES (p_game_id, g.mission_number, v_seat, v_role IS DISTINCT FROM 'AGRAVAIN', false);
        END IF;
    END LOOP;

    SELECT COUNT(*) INTO cards_in FROM mission_cards
        WHERE game_id = p_game_id AND mission_number = g.mission_number;
    IF cards_in < array_length(g.proposed_team, 1) THEN
        PERFORM pg_notify('avalon_game_updates', p_game_id::text);
        RETURN;
    END IF;

    -- Same tail as sp_cast_mission_card from here: hand off to Excalibur if
    -- it's in play and assigned this round, otherwise resolve outright.
    IF (g.settings->>'excalibur')::boolean AND g.excalibur_holder_seat IS NOT NULL THEN
        UPDATE games SET phase = 'excalibur_decision' WHERE id = p_game_id;
    ELSE
        SELECT COUNT(*) FILTER (WHERE NOT success AND NOT reversed) INTO fail_count
            FROM mission_cards WHERE game_id = p_game_id AND mission_number = g.mission_number;
        PERFORM _resolve_mission(p_game_id, fail_count);
    END IF;

    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
END;
$$ LANGUAGE plpgsql;
