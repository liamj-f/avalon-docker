-- Avalon: full live gameplay + history schema.
--
-- Once a game starts, these tables ARE the game: whose turn it is, the
-- current phase, every team proposal, every vote, every mission card, who
-- holds Lady of the Lake / Excalibur, etc. They're mutated exclusively
-- through the stored procedures in 002_procedures.sql, each of which ends
-- with pg_notify('avalon_game_updates', game_id) so the backend's LISTEN
-- connection (backend/src/game_notify.py) can push fresh state to players in
-- real time — including when a procedure is called by hand from psql
-- instead of by the app. See README for a worked example.
--
-- The lobby (who's connected, chat, the role preference poll, who's host)
-- stays in the backend's in-memory RoomManager (backend/src/rooms.py) — it's
-- inherently tied to live socket connections, which don't have a clean
-- row-per-fact shape, and doesn't need to survive a restart the way an
-- in-progress vote does.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Reference data: the standard Avalon mission/fail table, one row per
-- supported player count. Stored procedures look this up instead of having
-- the numbers baked into code — `SELECT * FROM mission_config` to see
-- exactly what drives team sizes.
CREATE TABLE mission_config (
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
    (10, ARRAY[3,4,4,5,5]::SMALLINT[], ARRAY[1,1,1,2,1]::SMALLINT[], 6, 4);

-- One row per game: the live state row while in progress, left in place
-- afterward as the history record.
CREATE TABLE games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code VARCHAR(8) NOT NULL,
    player_count INT NOT NULL,
    settings JSONB NOT NULL,          -- the role/extension toggles this game was dealt with
    seat_order SMALLINT[] NOT NULL DEFAULT '{}',

    -- Turn state
    phase VARCHAR(24) NOT NULL DEFAULT 'team_building',
    mission_number SMALLINT NOT NULL DEFAULT 0,
    leader_seat SMALLINT,
    rejection_count SMALLINT NOT NULL DEFAULT 0,
    proposed_team SMALLINT[],

    -- Lady of the Lake (both tokens below are public — who holds them is
    -- visible at the table; only what a holder learns is private)
    lady_holder_seat SMALLINT,
    lady_history SMALLINT[] NOT NULL DEFAULT '{}',

    -- Excalibur: re-assigned by each quest's leader as part of proposing
    -- the team (sp_propose_team) -- reusable every round, no game-wide
    -- limit (see sp_excalibur_decision).
    excalibur_holder_seat SMALLINT,
    -- Set by sp_excalibur_view, cleared by sp_excalibur_decision -- tracks
    -- which of this quest's participants the holder has committed to
    -- looking at (they only ever get to see one card, so this also guards
    -- against viewing a second).
    excalibur_viewing_seat SMALLINT,

    -- Lancelot: solo mode's single-use Reverse card, and the paired mode's
    -- secretly-predetermined automatic swap(s) -- 1 or 2 distinct mission
    -- numbers chosen once at deal time (rooms.py), never revealed ahead of
    -- time; each one reached flips the pair's allegiance again (see
    -- _resolve_mission).
    lancelot_reverse_used BOOLEAN NOT NULL DEFAULT false,
    swap_mission_numbers SMALLINT[],
    lancelots_swap_count SMALLINT NOT NULL DEFAULT 0,

    -- Assassination -- an array since the Assassin's guess is either one
    -- seat (Merlin/Gawain) or two (the Tristan & Iseult pair), or empty
    -- (passing on the guess entirely).
    assassination_target SMALLINT[],

    -- Outcome
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    winner VARCHAR(10),
    win_reason VARCHAR(40)
);

CREATE INDEX idx_games_room_code ON games(room_code);
CREATE INDEX idx_games_phase ON games(phase);

CREATE TABLE game_players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    seat SMALLINT NOT NULL,
    display_name VARCHAR(60) NOT NULL,
    role VARCHAR(40) NOT NULL,
    team VARCHAR(10) NOT NULL,        -- mutable: the paired Lancelots' team flips on swap
    knowledge JSONB NOT NULL DEFAULT '[]', -- precomputed once at deal time (backend/src/game/roles.js)
    was_assassinated BOOLEAN NOT NULL DEFAULT false,
    -- Generalized "this player has publicly revealed themselves" flag. Only
    -- Arthur can trigger it today, but it's modeled as a plain fact about a
    -- player rather than an Arthur-specific column, so it's reusable later.
    revealed BOOLEAN NOT NULL DEFAULT false,
    revealed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX game_players_game_seat_uq ON game_players(game_id, seat);
CREATE INDEX idx_game_players_game_id ON game_players(game_id);

CREATE TABLE game_missions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    mission_number INT NOT NULL,
    team_size INT NOT NULL,
    fails_required INT NOT NULL,
    team_seats JSONB NOT NULL,
    result VARCHAR(10) NOT NULL,      -- 'success' | 'fail' — after any Lancelot Reverse flip
    fail_count INT NOT NULL           -- raw Fail cards played, excluding a Reverse card and any Excalibur cleanse
);

CREATE INDEX idx_game_missions_game_id ON game_missions(game_id);

-- One row per team proposal (leader + team, at the moment it's proposed) so
-- a resolved vote's individual approve/reject choices can be shown back
-- later -- team_votes alone only ever records who voted which way, never
-- who was leading or who was on the team being voted on, and
-- games.proposed_team/leader_seat get overwritten by the next proposal the
-- instant one resolves. See sp_propose_team and load_game_state_for_seat's
-- voteHistory query (backend/src/game_db.py).
CREATE TABLE team_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    mission_number SMALLINT NOT NULL,
    attempt SMALLINT NOT NULL,
    leader_seat SMALLINT NOT NULL,
    team_seats JSONB NOT NULL,
    excalibur_seat SMALLINT,          -- NULL unless Excalibur was assigned with this proposal
    proposed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX team_proposals_uq ON team_proposals(game_id, mission_number, attempt);
CREATE INDEX idx_team_proposals_game ON team_proposals(game_id);

CREATE TABLE team_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    mission_number SMALLINT NOT NULL,
    attempt SMALLINT NOT NULL,        -- how many times this mission's team has been rejected before this vote
    seat SMALLINT NOT NULL,
    approve BOOLEAN NOT NULL,
    voted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX team_votes_uq ON team_votes(game_id, mission_number, attempt, seat);
CREATE INDEX idx_team_votes_game ON team_votes(game_id);

CREATE TABLE mission_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    mission_number SMALLINT NOT NULL,
    seat SMALLINT NOT NULL,
    success BOOLEAN NOT NULL,
    -- Lancelot's Reverse card: played instead of Success/Fail. Doesn't
    -- itself count as a fail; flips the quest's final result after normal
    -- tallying instead (see _resolve_mission in 002_procedures.sql).
    reversed BOOLEAN NOT NULL DEFAULT false,
    played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX mission_cards_uq ON mission_cards(game_id, mission_number, seat);
CREATE INDEX idx_mission_cards_game ON mission_cards(game_id);

CREATE TABLE lady_of_lake_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    mission_number SMALLINT NOT NULL,
    holder_seat SMALLINT NOT NULL,
    target_seat SMALLINT NOT NULL,
    revealed_team VARCHAR(10) NOT NULL, -- private to holder_seat; the app only ever shows this back to them
    used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per quest an Excalibur holder acted on -- whether or not they
-- actually used it. holder/target/original_* are public once the quest
-- resolves (everyone learns who viewed whom and whether it was used); only
-- the target's actual card value (original_success/original_reversed)
-- stays private to the holder and the target themselves (backend/src/
-- game_db.py only ever surfaces that pair to those two seats' own "you"
-- view).
CREATE TABLE excalibur_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    mission_number SMALLINT NOT NULL,
    holder_seat SMALLINT NOT NULL,
    used BOOLEAN NOT NULL,
    target_seat SMALLINT,
    original_success BOOLEAN,
    original_reversed BOOLEAN,
    new_success BOOLEAN,              -- NULL unless used = true
    used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
