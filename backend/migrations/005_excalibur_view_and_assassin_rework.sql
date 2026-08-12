-- Two independent reworks:
--
-- 1. Excalibur: the holder previously saw every quest participant's real
--    card at once (`you.excaliburParticipants`). The actual rule is
--    stricter -- the holder picks ONE participant to look at, sees only
--    that card, and only then decides whether to swap it. This splits the
--    old single-call sp_excalibur_decision into two: sp_excalibur_view
--    (pick a target, reveal just their card to the holder) and a leaner
--    sp_excalibur_decision (swap the *viewed* card, or don't -- no target
--    param anymore, since games.excalibur_viewing_seat now tracks it
--    server-side between the two calls).
--
--    Per an explicit follow-up instruction, the viewed seat is public once
--    the quest resolves *even when Excalibur wasn't used* -- e.g. "Bob
--    viewed Ryan's card but did not use Excalibur." That's broader than
--    the base rule's "everyone learns who it was used *on*", but it's what
--    was asked for, so excalibur_events.target_seat is now recorded (and
--    surfaced in missionResults) unconditionally, not just when used=true.
--    The *value* of that card stays private to the holder and the target
--    themselves either way (both already legitimately know it -- the
--    holder because they viewed it, the target because they played it).
--
-- 2. Assassination gets two new routes to a win, alongside naming Merlin:
--      - Gawain: a plain Good role with no knowledge of his own, added
--        purely as a second name the Assassin can win by guessing --
--        naming him instead of Merlin also wins for Evil.
--      - The pair: naming *both* Tristan and Iseult correctly (proof the
--        Assassin cracked the secret couple) also wins for Evil.
--    The Assassin now submits 1 target (a Merlin/Gawain guess) or 2 (a
--    Tristan & Iseult guess) in one call, so games.assassination_target
--    becomes an array to hold either shape.

ALTER TABLE games ADD COLUMN excalibur_viewing_seat SMALLINT;

ALTER TABLE games ALTER COLUMN assassination_target TYPE SMALLINT[]
    USING (CASE WHEN assassination_target IS NULL THEN NULL ELSE ARRAY[assassination_target] END);

-- CREATE OR REPLACE can't change a function's parameter list -- these two
-- are getting new signatures (sp_excalibur_decision drops p_target_seat;
-- sp_submit_assassination's target becomes an array), so the old
-- signatures have to go first or both overloads stick around and every
-- call with a NULL-typed argument becomes ambiguous between them.
DROP FUNCTION IF EXISTS sp_excalibur_decision(UUID, INT, BOOLEAN, INT, BOOLEAN);
DROP FUNCTION IF EXISTS sp_submit_assassination(UUID, INT, INT);

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
    hit BOOLEAN;
BEGIN
    SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Game not found.'; END IF;
    IF g.phase <> 'assassination' THEN RAISE EXCEPTION 'Not in the assassination phase.'; END IF;

    SELECT seat INTO assassin_seat FROM game_players WHERE game_id = p_game_id AND role = 'ASSASSIN';
    IF assassin_seat IS NULL OR assassin_seat <> p_seat THEN
        RAISE EXCEPTION 'Only the Assassin may name a target.';
    END IF;

    target_count := COALESCE(array_length(p_target_seats, 1), 0);
    IF target_count NOT IN (1, 2) THEN
        RAISE EXCEPTION 'Name one player (a Merlin/Gawain guess) or exactly two (a Tristan & Iseult guess).';
    END IF;
    IF (SELECT COUNT(DISTINCT x) FROM unnest(p_target_seats) x) <> target_count THEN
        RAISE EXCEPTION 'Targets must be distinct.';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(p_target_seats) s WHERE s <> ALL(g.seat_order)) THEN
        RAISE EXCEPTION 'Invalid target.';
    END IF;

    SELECT seat INTO merlin_seat FROM game_players WHERE game_id = p_game_id AND role = 'MERLIN';
    SELECT seat INTO gawain_seat FROM game_players WHERE game_id = p_game_id AND role = 'GAWAIN';
    SELECT seat INTO tristan_seat FROM game_players WHERE game_id = p_game_id AND role = 'TRISTAN';
    SELECT seat INTO iseult_seat FROM game_players WHERE game_id = p_game_id AND role = 'ISEULT';

    IF target_count = 1 THEN
        hit := COALESCE(p_target_seats[1] = merlin_seat, false) OR COALESCE(p_target_seats[1] = gawain_seat, false);
    ELSE
        -- Explicit ::INT[] cast: seat columns are SMALLINT, p_target_seats
        -- is INT[], and <@ (unlike scalar comparison operators) has no
        -- built-in smallint[]/int[] cross-type match -- fails at runtime
        -- with "operator does not exist" otherwise.
        hit := tristan_seat IS NOT NULL AND iseult_seat IS NOT NULL
               AND p_target_seats <@ ARRAY[tristan_seat, iseult_seat]::INT[];
    END IF;

    UPDATE game_players SET was_assassinated = true WHERE game_id = p_game_id AND seat = ANY(p_target_seats);
    UPDATE games SET phase = 'game_over',
                      assassination_target = p_target_seats,
                      winner = CASE WHEN hit THEN 'evil' ELSE 'good' END,
                      win_reason = 'assassination',
                      ended_at = now()
        WHERE id = p_game_id;

    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
END;
$$ LANGUAGE plpgsql;
