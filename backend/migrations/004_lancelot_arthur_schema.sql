-- Schema for Agravain (forced-fail, no new columns needed — enforced in
-- 005's sp_cast_mission_card), Arthur (public self-reveal), and the two
-- Lancelot mechanics (solo Reverse card, paired random swap).

-- Generalized "this player has publicly revealed themselves" flag. Only
-- Arthur can trigger it today, but it's modeled as a plain fact about a
-- player rather than an Arthur-specific column so it's reusable later.
ALTER TABLE game_players
    ADD COLUMN IF NOT EXISTS revealed BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS revealed_at TIMESTAMPTZ;

-- Lancelot's Reverse card: a mission card can be played as neither
-- Success nor Fail but as a Reverse, which flips that quest's final
-- result after normal tallying instead of counting as a fail itself.
ALTER TABLE mission_cards
    ADD COLUMN IF NOT EXISTS reversed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE games
    -- Solo Lancelot: the Reverse card is a single-use item for the whole game.
    ADD COLUMN IF NOT EXISTS lancelot_reverse_used BOOLEAN NOT NULL DEFAULT false,
    -- Paired Lancelots: which mission (0-indexed), decided secretly and
    -- randomly at game start, triggers the automatic allegiance swap. NULL
    -- when the pair isn't in play.
    ADD COLUMN IF NOT EXISTS swap_mission_number SMALLINT,
    ADD COLUMN IF NOT EXISTS lancelots_swapped BOOLEAN NOT NULL DEFAULT false;
