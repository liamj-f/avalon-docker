-- Reworks Excalibur to match the real expansion rule (previously this app
-- had invented a simpler one: a single random Good player held it for the
-- whole game and could only ever cleanse one Fail on a quest that already
-- had one). The actual rule:
--
--   1. Assigning: proposing a team's leader also designates one OTHER
--      player *on that team* to hold Excalibur for that quest (never
--      themselves) -- as long as it hasn't been used yet. Visible to
--      everyone before they vote on the team.
--   2. Using: once all of that quest's cards are in, the holder sees every
--      participant's actual submitted card and may change exactly one
--      participant's card (success<->fail), or decline. If the targeted
--      card is Lancelot's Reverse card, there's no natural "opposite" to
--      flip to, so the holder explicitly picks Success or Fail instead --
--      which also strips its reverse behavior (a still-reversed card is
--      what flips the quest's final result, in _resolve_mission).
--   3. Single-use: still spent forever the instant it's actually used,
--      exactly as before -- just now re-assigned fresh by each quest's
--      leader (from that quest's team) until the moment it's spent, rather
--      than fixed to one player from game start.
--   4. Transparency: everyone learns, once a quest resolves, who held
--      Excalibur, whether they used it, and (if so) who they targeted.
--      Nobody except the holder and the target ever learns the target's
--      *original* card -- game_db.py only ever surfaces that pair to those
--      two seats' own "you" view.
--
-- games.pending_fail_count is no longer written (the holder now sees real
-- cards, not a count) -- left in the schema rather than dropped, since
-- nothing reads it either and dropping a live column is needless risk for
-- a column that's simply unused going forward.

ALTER TABLE team_proposals ADD COLUMN excalibur_seat SMALLINT;

ALTER TABLE excalibur_events
    DROP COLUMN fail_count_before,
    DROP COLUMN fail_count_after,
    ADD COLUMN target_seat SMALLINT,
    ADD COLUMN original_success BOOLEAN,
    ADD COLUMN original_reversed BOOLEAN,
    ADD COLUMN new_success BOOLEAN;

CREATE OR REPLACE FUNCTION sp_propose_team(
    p_game_id UUID, p_leader_seat INT, p_team INT[],
    p_excalibur_seat INT DEFAULT NULL -- required iff Excalibur is enabled and not yet used
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

    excalibur_active := (g.settings->>'excalibur')::boolean AND NOT g.excalibur_used;
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

    -- Excalibur now looks at *every* quest (not just ones that already came
    -- back with a Fail) as long as it's assigned and unspent -- the holder
    -- can flip any one participant's card either direction, not just
    -- cleanse a Fail. See sp_excalibur_decision.
    IF (g.settings->>'excalibur')::boolean AND g.excalibur_holder_seat IS NOT NULL AND NOT g.excalibur_used THEN
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
    p_target_seat INT DEFAULT NULL,
    p_new_success BOOLEAN DEFAULT NULL -- only consulted when the target's card is Lancelot's Reverse card
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

    IF p_use THEN
        IF p_target_seat IS NULL THEN RAISE EXCEPTION 'Choose a player to change.'; END IF;
        IF p_target_seat <> ALL(g.proposed_team) THEN RAISE EXCEPTION 'Excalibur can only target a player on this quest.'; END IF;

        SELECT * INTO target_card FROM mission_cards
            WHERE game_id = p_game_id AND mission_number = g.mission_number AND seat = p_target_seat;
        IF NOT FOUND THEN RAISE EXCEPTION 'That player has not played a card yet.'; END IF;

        IF target_card.reversed THEN
            IF p_new_success IS NULL THEN
                RAISE EXCEPTION 'Choose Success or Fail for the Reverse card.';
            END IF;
            v_new_success := p_new_success;
        ELSE
            v_new_success := NOT target_card.success;
        END IF;

        UPDATE mission_cards SET success = v_new_success, reversed = false
            WHERE game_id = p_game_id AND mission_number = g.mission_number AND seat = p_target_seat;

        INSERT INTO excalibur_events (
            game_id, mission_number, holder_seat, used, target_seat,
            original_success, original_reversed, new_success
        ) VALUES (
            p_game_id, g.mission_number, p_seat, true, p_target_seat,
            target_card.success, target_card.reversed, v_new_success
        );
    ELSE
        INSERT INTO excalibur_events (game_id, mission_number, holder_seat, used)
        VALUES (p_game_id, g.mission_number, p_seat, false);
    END IF;

    -- Single legendary use per game: spent once, gone for good. Declining
    -- doesn't spend it -- the *next* quest's leader assigns it again
    -- (sp_propose_team) -- but either way this quest's holder is cleared so
    -- it doesn't linger as a stale display between quests.
    UPDATE games SET excalibur_used = excalibur_used OR p_use,
                      excalibur_holder_seat = NULL
        WHERE id = p_game_id;

    SELECT COUNT(*) FILTER (WHERE NOT success AND NOT reversed) INTO fail_count
        FROM mission_cards WHERE game_id = p_game_id AND mission_number = g.mission_number;
    PERFORM _resolve_mission(p_game_id, fail_count);
    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
END;
$$ LANGUAGE plpgsql;
