-- Persists one row per team proposal (leader + team, at the moment it's
-- proposed) so a resolved vote's individual approve/reject choices can be
-- shown back later -- team_votes alone only ever recorded who voted which
-- way, never who was leading or who was on the team being voted on, and
-- games.proposed_team/leader_seat get overwritten by the next proposal the
-- instant one resolves, so that context was otherwise lost the moment a
-- vote finished. See sp_propose_team below and load_game_state_for_seat's
-- voteHistory query (backend/src/game_db.py).
CREATE TABLE team_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    mission_number SMALLINT NOT NULL,
    attempt SMALLINT NOT NULL,
    leader_seat SMALLINT NOT NULL,
    team_seats JSONB NOT NULL,
    proposed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX team_proposals_uq ON team_proposals(game_id, mission_number, attempt);
CREATE INDEX idx_team_proposals_game ON team_proposals(game_id);

CREATE OR REPLACE FUNCTION sp_propose_team(p_game_id UUID, p_leader_seat INT, p_team INT[])
RETURNS VOID AS $$
DECLARE
    g games%ROWTYPE;
    mc mission_config%ROWTYPE;
    expected_size SMALLINT;
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

    INSERT INTO team_proposals (game_id, mission_number, attempt, leader_seat, team_seats)
    VALUES (p_game_id, g.mission_number, g.rejection_count, p_leader_seat, to_jsonb(p_team));

    UPDATE games SET proposed_team = p_team, phase = 'team_voting' WHERE id = p_game_id;
    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
END;
$$ LANGUAGE plpgsql;
