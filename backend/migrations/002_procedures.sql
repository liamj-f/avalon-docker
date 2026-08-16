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
-- Python app (backend/src/game/roles.py) — it's already unit-tested there —
-- this just persists the result and sets up initial turn state.
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
        room_code, player_count, settings, seat_order, leader_seat,
        lady_holder_seat, excalibur_holder_seat, swap_mission_number, phase, started_at
    ) VALUES (
        p_room_code, array_length(p_seat_order, 1), p_settings, p_seat_order, p_leader_seat,
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

-- p_excalibur_seat: the OTHER player (never the leader) on this team the
-- leader is designating to hold Excalibur for this quest -- required iff
-- Excalibur is enabled and not yet spent for the game, ignored otherwise.
-- Visible to everyone before they vote on the team.
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

    -- Excalibur looks at *every* quest (not just ones that already came
    -- back with a Fail) as long as it's assigned and unspent -- the holder
    -- can flip any one participant's card either direction, not just
    -- cleanse a Fail. See sp_excalibur_view/sp_excalibur_decision.
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

-- The holder picks ONE participant to look at, sees only that card, and
-- only then decides (sp_excalibur_decision) whether to swap it -- they
-- don't get to browse everyone's card first.
CREATE OR REPLACE FUNCTION sp_excalibur_view(p_game_id UUID, p_seat INT, p_target_seat INT)
RETURNS VOID AS $$
DECLARE
    g games%ROWTYPE;
BEGIN
    SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Game not found.'; END IF;
    IF g.phase <> 'excalibur_decision' THEN RAISE EXCEPTION 'Not in the Excalibur decision phase.'; END IF;
    IF g.excalibur_holder_seat <> p_seat THEN RAISE EXCEPTION 'Only the Excalibur holder may view a card.'; END IF;
    IF g.excalibur_viewing_seat IS NOT NULL THEN
        RAISE EXCEPTION 'You have already viewed a card this quest.';
    END IF;
    IF p_target_seat <> ALL(g.proposed_team) THEN RAISE EXCEPTION 'Excalibur can only view a player on this quest.'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM mission_cards WHERE game_id = p_game_id AND mission_number = g.mission_number AND seat = p_target_seat
    ) THEN
        RAISE EXCEPTION 'That player has not played a card yet.';
    END IF;

    UPDATE games SET excalibur_viewing_seat = p_target_seat WHERE id = p_game_id;
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

    -- Single legendary use per game: spent once, gone for good. Declining
    -- doesn't spend it -- the *next* quest's leader assigns it again
    -- (sp_propose_team) -- but either way this quest's holder/viewing state
    -- is cleared so it doesn't linger as a stale display between quests.
    UPDATE games SET excalibur_used = excalibur_used OR p_use,
                      excalibur_holder_seat = NULL,
                      excalibur_viewing_seat = NULL
        WHERE id = p_game_id;

    SELECT COUNT(*) FILTER (WHERE NOT success AND NOT reversed) INTO fail_count
        FROM mission_cards WHERE game_id = p_game_id AND mission_number = g.mission_number;
    PERFORM _resolve_mission(p_game_id, fail_count);
    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
END;
$$ LANGUAGE plpgsql;

-- Shared tail end of a mission: record the result (after any Lancelot
-- Reverse flip), apply the paired Lancelots' scheduled swap if this is the
-- mission it lands on, check both win conditions, and figure out the next
-- phase (Lady of the Lake, the assassination, or straight back to
-- team-building).
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

-- The Assassin picks exactly one of three modes:
--   1. Guess Merlin: name 1 seat. Correct if it's Merlin -> Evil wins.
--      Naming Gawain instead (only ever a valid guess in this mode, never
--      the pair mode below) wins for Gawain alone, not Evil -- he's a
--      third faction with his own win condition, distinct from Evil's.
--   2. Guess the Lovers: name exactly 2 seats. Correct only if they're
--      exactly {Tristan, Iseult} -> Evil wins.
--   3. Pass: name nobody. Always resolves Good's win as final -- no guess
--      is made, so nothing is revealed and nobody is marked assassinated.
CREATE OR REPLACE FUNCTION sp_submit_assassination(p_game_id UUID, p_seat INT, p_target_seats INT[])
RETURNS VOID AS $$
DECLARE
    g games%ROWTYPE;
    assassin_seat SMALLINT;
    merlin_seat SMALLINT;
    gawain_seat SMALLINT;
    tristan_seat SMALLINT;
    iseult_seat SMALLINT;
    target_count INT;
    result_winner VARCHAR(10);
BEGIN
    SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Game not found.'; END IF;
    IF g.phase <> 'assassination' THEN RAISE EXCEPTION 'Not in the assassination phase.'; END IF;

    SELECT seat INTO assassin_seat FROM game_players WHERE game_id = p_game_id AND role = 'ASSASSIN';
    IF assassin_seat IS NULL OR assassin_seat <> p_seat THEN
        RAISE EXCEPTION 'Only the Assassin may name a target.';
    END IF;

    target_count := COALESCE(array_length(p_target_seats, 1), 0);
    IF target_count NOT IN (0, 1, 2) THEN
        RAISE EXCEPTION 'Pass (name nobody), guess Merlin (name one player), or guess the Lovers (name exactly two).';
    END IF;
    IF target_count > 0 THEN
        IF (SELECT COUNT(DISTINCT x) FROM unnest(p_target_seats) x) <> target_count THEN
            RAISE EXCEPTION 'Targets must be distinct.';
        END IF;
        IF EXISTS (SELECT 1 FROM unnest(p_target_seats) s WHERE s <> ALL(g.seat_order)) THEN
            RAISE EXCEPTION 'Invalid target.';
        END IF;
    END IF;

    SELECT seat INTO merlin_seat FROM game_players WHERE game_id = p_game_id AND role = 'MERLIN';
    SELECT seat INTO gawain_seat FROM game_players WHERE game_id = p_game_id AND role = 'GAWAIN';
    SELECT seat INTO tristan_seat FROM game_players WHERE game_id = p_game_id AND role = 'TRISTAN';
    SELECT seat INTO iseult_seat FROM game_players WHERE game_id = p_game_id AND role = 'ISEULT';

    IF target_count = 0 THEN
        result_winner := 'good'; -- pass forfeits the guess outright -- Good's win stands
    ELSIF target_count = 1 THEN
        IF COALESCE(p_target_seats[1] = merlin_seat, false) THEN
            result_winner := 'evil';
        ELSIF COALESCE(p_target_seats[1] = gawain_seat, false) THEN
            result_winner := 'gawain';
        ELSE
            result_winner := 'good';
        END IF;
    ELSE
        IF tristan_seat IS NOT NULL AND iseult_seat IS NOT NULL
           AND p_target_seats <@ ARRAY[tristan_seat, iseult_seat]::INT[] THEN
            result_winner := 'evil';
        ELSE
            result_winner := 'good'; -- Gawain has no win condition in this mode, win or lose
        END IF;
    END IF;

    IF target_count > 0 THEN
        -- Marks who was named, win or lose -- this column tracks "was the
        -- Assassin's target", not "was the guess correct" (the frontend
        -- derives the latter from `winner` itself).
        UPDATE game_players SET was_assassinated = true WHERE game_id = p_game_id AND seat = ANY(p_target_seats);
    END IF;
    UPDATE games SET phase = 'game_over',
                      assassination_target = p_target_seats,
                      winner = result_winner,
                      win_reason = 'assassination',
                      ended_at = now()
        WHERE id = p_game_id;

    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
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

-- A disconnected team member previously stalled a quest forever --
-- sp_cast_mission_card only resolves once every team seat has a card, and
-- the only escape hatch was resetting the whole game to the lobby. This
-- gives the host an explicit one instead: auto-play a card for any team
-- seat that's both (a) currently disconnected -- checked by the caller,
-- not here, since connection status lives in the in-memory Room, not
-- Postgres -- and (b) hasn't already submitted one. The auto-played card
-- mirrors what that seat's role is actually constrained to play for real:
-- Agravain is forced to Fail on every quest regardless of who's at the
-- keyboard, so defaulting them to Fail is simply correct, not a guess.
-- Every other role defaults to the charitable Success, so this can never
-- be used to sneak in a Fail on an absent player's behalf.
--
-- Safe to call speculatively: if fewer cards are in than the team size even
-- after filling in the disconnected seats (i.e. someone still-connected
-- just hasn't played yet), it's a no-op -- the host can just try again once
-- more of the team is actually disconnected.
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
    -- it's in play and unspent, otherwise resolve outright.
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
