-- Moves live gameplay state (team proposals, votes, mission cards, turn
-- order, Lady of the Lake, Excalibur...) into Postgres itself. Once a game
-- starts, these tables ARE the game: the backend mutates them exclusively
-- through the stored procedures in 003_stored_procedures.sql, and reacts to
-- pg_notify('avalon_game_updates', game_id) to push fresh state to
-- connected players — including when a procedure is called by hand from
-- psql rather than by the app. See README for example queries.
--
-- The lobby (who's connected, chat, role preference poll, who's host) stays
-- in the backend's in-memory RoomManager: it's inherently tied to live
-- socket connections, which don't have a clean row-per-fact shape, and
-- nothing about it needs to survive a restart the way an in-progress vote
-- does.

DROP TABLE IF EXISTS rooms; -- defined in 001 but never actually used

-- Reference data: the standard Avalon mission/fail table, one row per
-- supported player count. Stored procedures look this up instead of having
-- the numbers baked into code — feel free to `SELECT * FROM mission_config`
-- to see exactly what drives team sizes.
CREATE TABLE IF NOT EXISTS mission_config (
    player_count SMALLINT PRIMARY KEY CHECK (player_count BETWEEN 5 AND 10),
    team_sizes SMALLINT[] NOT NULL,
    fails_required SMALLINT[] NOT NULL,
    good_count SMALLINT NOT NULL,
    evil_count SMALLINT NOT NULL
);

INSERT INTO mission_config (player_count, team_sizes, fails_required, good_count, evil_count) VALUES
    (5,  ARRAY[2,3,2,3,3]::SMALLINT[], ARRAY[1,1,1,1,1]::SMALLINT[], 3, 2),
    (6,  ARRAY[2,3,4,3,4]::SMALLINT[], ARRAY[1,1,1,1,1]::SMALLINT[], 4, 2),
    (7,  ARRAY[2,3,3,4,4]::SMALLINT[], ARRAY[1,1,1,2,1]::SMALLINT[], 4, 3),
    (8,  ARRAY[3,4,4,5,5]::SMALLINT[], ARRAY[1,1,1,2,1]::SMALLINT[], 5, 3),
    (9,  ARRAY[3,4,4,5,5]::SMALLINT[], ARRAY[1,1,1,2,1]::SMALLINT[], 6, 3),
    (10, ARRAY[3,4,4,5,5]::SMALLINT[], ARRAY[1,1,1,2,1]::SMALLINT[], 6, 4)
ON CONFLICT (player_count) DO NOTHING;

-- `games` was a finished-game log in 001; it becomes the live state row for
-- an in-progress game too, updated in place by the stored procedures.
-- 001 named this winning_team; every live-state column added below and every
-- stored procedure in 003 refers to the shorter `winner`, so bring it in
-- line rather than carry two names for the same fact.
ALTER TABLE games RENAME COLUMN winning_team TO winner;

ALTER TABLE games
    ADD COLUMN IF NOT EXISTS settings JSONB,
    ADD COLUMN IF NOT EXISTS seat_order SMALLINT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS phase VARCHAR(24) NOT NULL DEFAULT 'team_building',
    ADD COLUMN IF NOT EXISTS mission_number SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS leader_seat SMALLINT,
    ADD COLUMN IF NOT EXISTS rejection_count SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS proposed_team SMALLINT[],
    ADD COLUMN IF NOT EXISTS pending_fail_count SMALLINT,
    ADD COLUMN IF NOT EXISTS lady_holder_seat SMALLINT,
    ADD COLUMN IF NOT EXISTS lady_history SMALLINT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS excalibur_holder_seat SMALLINT,
    ADD COLUMN IF NOT EXISTS excalibur_used BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS assassination_target SMALLINT;

ALTER TABLE game_players
    ADD COLUMN IF NOT EXISTS knowledge JSONB NOT NULL DEFAULT '[]';

-- One row per (game, seat); stored procedures rely on this to be unique.
CREATE UNIQUE INDEX IF NOT EXISTS game_players_game_seat_uq ON game_players(game_id, seat);

CREATE TABLE IF NOT EXISTS team_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    mission_number SMALLINT NOT NULL,
    attempt SMALLINT NOT NULL, -- how many times this mission's team has been rejected before this vote
    seat SMALLINT NOT NULL,
    approve BOOLEAN NOT NULL,
    voted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS team_votes_uq ON team_votes(game_id, mission_number, attempt, seat);

CREATE TABLE IF NOT EXISTS mission_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    mission_number SMALLINT NOT NULL,
    seat SMALLINT NOT NULL,
    success BOOLEAN NOT NULL,
    played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mission_cards_uq ON mission_cards(game_id, mission_number, seat);

CREATE TABLE IF NOT EXISTS lady_of_lake_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    mission_number SMALLINT NOT NULL,
    holder_seat SMALLINT NOT NULL,
    target_seat SMALLINT NOT NULL,
    revealed_team VARCHAR(10) NOT NULL,
    used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS excalibur_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    mission_number SMALLINT NOT NULL,
    holder_seat SMALLINT NOT NULL,
    used BOOLEAN NOT NULL,
    fail_count_before SMALLINT NOT NULL,
    fail_count_after SMALLINT NOT NULL,
    used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_votes_game ON team_votes(game_id);
CREATE INDEX IF NOT EXISTS idx_mission_cards_game ON mission_cards(game_id);
CREATE INDEX IF NOT EXISTS idx_games_phase ON games(phase);
