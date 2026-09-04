-- The Excalibur holder could view (and therefore swap) their OWN card --
-- sp_excalibur_view only ever checked that the target was on the proposed
-- team, and the holder is themselves a team member (that's how they got
-- the sword in the first place), so nothing stopped p_target_seat ==
-- p_seat. Fixed at the same point sp_propose_team already guards the
-- *assignment* side of this ("the leader cannot hold Excalibur themselves"):
-- the holder must target someone else's card, never their own.
CREATE OR REPLACE FUNCTION sp_excalibur_view(p_game_id UUID, p_seat INT, p_target_seat INT)
RETURNS VOID AS $$
DECLARE
    g games%ROWTYPE;
BEGIN
    SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Game not found.'; END IF;
    IF g.phase <> 'excalibur_decision' THEN RAISE EXCEPTION 'Not in the Excalibur decision phase.'; END IF;
    IF g.excalibur_holder_seat <> p_seat THEN RAISE EXCEPTION 'Only the Excalibur holder may view a card.'; END IF;
    IF p_target_seat = p_seat THEN RAISE EXCEPTION 'Excalibur cannot be used on your own card -- pick someone else on the quest.'; END IF;
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
