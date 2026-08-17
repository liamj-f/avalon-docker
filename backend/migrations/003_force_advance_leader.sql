-- A disconnected leader previously stalled the game forever at
-- team-building: unlike the other force-resolve escape hatches, there's
-- nothing here to fill in on the missing player's behalf -- nobody
-- proposes a team *for* them, since there's no charitable default for who
-- someone else would have put on it. The only fair way out is skipping
-- their turn as leader entirely, the same as a real player passing the
-- conch to whoever's next. Deliberately does NOT touch rejection_count --
-- that track (and the 5-rejections-in-a-row auto-loss it drives) is
-- specifically about proposals the table actually voted down, not turns
-- skipped because a seat was unreachable, so this can never end the game
-- by itself. Only valid before a team's been proposed this turn (once
-- proposed, phase is already team_voting, and a stuck leader from here on
-- is sp_force_resolve_team_vote's job instead).
CREATE OR REPLACE FUNCTION sp_force_advance_leader(p_game_id UUID)
RETURNS VOID AS $$
DECLARE
    g games%ROWTYPE;
BEGIN
    SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Game not found.'; END IF;
    IF g.phase <> 'team_building' THEN RAISE EXCEPTION 'Not waiting on a team proposal.'; END IF;

    UPDATE games SET leader_seat = _next_seat(g.seat_order, g.leader_seat) WHERE id = p_game_id;
    PERFORM pg_notify('avalon_game_updates', p_game_id::text);
END;
$$ LANGUAGE plpgsql;
