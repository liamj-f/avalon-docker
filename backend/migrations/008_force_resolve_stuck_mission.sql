-- Previously, a disconnected team member stalled a quest forever:
-- sp_cast_mission_card only resolves once every seat on proposed_team has
-- submitted a card, and there was no way to make progress without the host
-- nuking the whole game back to the lobby (room:resetToLobby).
--
-- This gives the host an explicit escape hatch instead. It auto-plays a
-- card for any team seat that's both (a) currently disconnected -- checked
-- by the caller, not here, since connection status lives in the in-memory
-- Room, not Postgres -- and (b) hasn't already submitted one. The
-- auto-played card mirrors what that seat's role is actually constrained
-- to play for real: Agravain is forced to Fail on every quest regardless
-- of who's at the keyboard, so defaulting them to Fail is simply correct,
-- not a guess. Every other role defaults to the charitable Success, so
-- this can never be used to sneak in a Fail on an absent player's behalf.
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

    -- Same tail as sp_cast_mission_card from here: tally fails, hand off to
    -- Excalibur if it's in play and eligible, otherwise resolve outright.
    SELECT COUNT(*) FILTER (WHERE NOT success AND NOT reversed) INTO fail_count
        FROM mission_cards WHERE game_id = p_game_id AND mission_number = g.mission_number;

    IF (g.settings->>'excalibur')::boolean AND g.excalibur_holder_seat IS NOT NULL
       AND NOT g.excalibur_used AND fail_count >= 1 THEN
        UPDATE games SET phase = 'excalibur_decision', pending_fail_count = fail_count WHERE id = p_game_id;
    ELSE
        PERFORM _resolve_mission(p_game_id, fail_count);
    END IF;

    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
END;
$$ LANGUAGE plpgsql;
