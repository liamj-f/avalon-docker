-- Avalon: history/persistence schema.
-- Live gameplay state lives in the backend process memory (it is inherently
-- transient and highly write-heavy); Postgres stores completed rooms/games
-- so lobbies survive a backend restart and so game history/stats can be
-- queried later.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(8) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code VARCHAR(8) NOT NULL,
    player_count INT NOT NULL,
    roles_config JSONB NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    winning_team VARCHAR(10),
    win_reason VARCHAR(40)
);

CREATE TABLE IF NOT EXISTS game_players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    seat INT NOT NULL,
    display_name VARCHAR(60) NOT NULL,
    role VARCHAR(40) NOT NULL,
    team VARCHAR(10) NOT NULL,
    was_assassinated BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS game_missions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    mission_number INT NOT NULL,
    team_size INT NOT NULL,
    fails_required INT NOT NULL,
    team_seats JSONB NOT NULL,
    result VARCHAR(10) NOT NULL,
    fail_count INT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_players_game_id ON game_players(game_id);
CREATE INDEX IF NOT EXISTS idx_game_missions_game_id ON game_missions(game_id);
CREATE INDEX IF NOT EXISTS idx_games_room_code ON games(room_code);
