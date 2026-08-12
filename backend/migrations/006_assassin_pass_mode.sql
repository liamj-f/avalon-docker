-- Rounds out the Assassin's final action to match the real mechanic
-- exactly: Evil (via the Assassin) picks ONE of three modes and Evil only
-- wins if the guess matches that mode's win condition exactly --
--   1. Guess Merlin: name exactly 1 seat. Correct if it's Merlin, OR
--      Gawain if he's in play -- Gawain is only ever a valid answer in
--      *this* mode, never the pair mode (unchanged from 005; noted here
--      since it's easy to misread as "Gawain always wins if named").
--   2. Guess the Lovers: name exactly 2 seats. Correct only if they're
--      exactly {Tristan, Iseult} (already implemented in 005).
--   3. Pass: name nobody. Always resolves Good's win as final -- no guess
--      is made, so nothing is revealed and nobody is marked assassinated.
--
-- 005 only accepted 1 or 2 targets, leaving "decline to guess" as an
-- unreachable UI state (the Assassin was forced to name *someone*, even
-- if just to lose on purpose) rather than the real mechanic's explicit
-- third choice with its own, narratively distinct outcome (no reveal).
DROP FUNCTION IF EXISTS sp_submit_assassination(UUID, INT, INT[]);

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
        hit := false; -- passing forfeits outright -- there's no guess to match, so it never wins
    ELSIF target_count = 1 THEN
        hit := COALESCE(p_target_seats[1] = merlin_seat, false) OR COALESCE(p_target_seats[1] = gawain_seat, false);
    ELSE
        hit := tristan_seat IS NOT NULL AND iseult_seat IS NOT NULL
               AND p_target_seats <@ ARRAY[tristan_seat, iseult_seat]::INT[];
    END IF;

    IF target_count > 0 THEN
        UPDATE game_players SET was_assassinated = true WHERE game_id = p_game_id AND seat = ANY(p_target_seats);
    END IF;
    UPDATE games SET phase = 'game_over',
                      assassination_target = p_target_seats,
                      winner = CASE WHEN hit THEN 'evil' ELSE 'good' END,
                      win_reason = 'assassination',
                      ended_at = now()
        WHERE id = p_game_id;

    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
END;
$$ LANGUAGE plpgsql;
