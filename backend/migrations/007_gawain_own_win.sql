-- Fixes a real mechanical error in 006: Gawain is not "one more way for
-- Evil to win" -- he's a third faction with his own win condition,
-- distinct from Evil's. In the "guess Merlin" mode specifically:
--   * Assassin names Merlin correctly -> Evil wins.
--   * Assassin names Gawain           -> Gawain wins (alone -- not Evil).
--   * Assassin names anyone else      -> Good wins.
-- Gawain never wins via the "guess the Lovers" mode, even if the Assassin
-- (for whatever reason) names him as one of the two -- that mode's only
-- winners are Evil (exact Tristan & Iseult match) or Good (anything else).
-- 006 folded the Gawain case into `hit`/'evil', which meant Good's actual
-- team-vs-team loss condition (Merlin survives) was reported as an Evil
-- team win even though Evil's own guess (Merlin) was wrong.
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
        -- Marks who was named, win or lose -- unchanged from 006, this
        -- column tracks "was the Assassin's target", not "was the guess
        -- correct" (the frontend derives the latter from `winner` itself).
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
