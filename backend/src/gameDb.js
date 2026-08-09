const { pool } = require('./db');
const { ROLES } = require('./game/roles');

/** Persists a freshly-dealt game and its initial turn state. */
async function startGame({ roomCode, settings, seatOrder, leaderSeat, ladyHolderSeat, excaliburHolderSeat, players }) {
  const { rows } = await pool.query('SELECT sp_start_game($1,$2,$3,$4,$5,$6,$7) AS id', [
    roomCode,
    settings,
    seatOrder,
    leaderSeat,
    ladyHolderSeat,
    excaliburHolderSeat,
    JSON.stringify(players),
  ]);
  return rows[0].id;
}

async function proposeTeam(gameId, leaderSeat, team) {
  await pool.query('SELECT sp_propose_team($1,$2,$3)', [gameId, leaderSeat, team]);
}

async function castTeamVote(gameId, seat, approve) {
  await pool.query('SELECT sp_cast_team_vote($1,$2,$3)', [gameId, seat, approve]);
}

async function castMissionVote(gameId, seat, success) {
  await pool.query('SELECT sp_cast_mission_card($1,$2,$3)', [gameId, seat, success]);
}

async function excaliburDecision(gameId, seat, use) {
  await pool.query('SELECT sp_excalibur_decision($1,$2,$3)', [gameId, seat, use]);
}

async function useLadyOfLake(gameId, seat, targetSeat) {
  await pool.query('SELECT sp_use_lady_of_lake($1,$2,$3)', [gameId, seat, targetSeat]);
}

async function submitAssassination(gameId, seat, targetSeat) {
  await pool.query('SELECT sp_submit_assassination($1,$2,$3)', [gameId, seat, targetSeat]);
}

/**
 * Reads back the full, per-seat-redacted view of a live (or finished) game
 * straight from the tables the stored procedures maintain — this is the
 * counterpart to AvalonGame.serializeForSeat() in the earlier in-memory
 * design, just backed by SQL SELECTs instead of an object in RAM.
 */
async function loadGameStateForSeat(gameId, seat) {
  const { rows: gameRows } = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
  const g = gameRows[0];
  if (!g) return null;

  const { rows: mcRows } = await pool.query('SELECT * FROM mission_config WHERE player_count = $1', [g.player_count]);
  const mc = mcRows[0];

  const { rows: missionRows } = await pool.query(
    `SELECT mission_number, team_size, fails_required, team_seats, result, fail_count
       FROM game_missions WHERE game_id = $1 ORDER BY mission_number`,
    [gameId]
  );

  const base = {
    phase: g.phase,
    missionNumber: g.mission_number,
    teamSizes: mc.team_sizes,
    failsRequired: mc.fails_required,
    leaderSeat: g.leader_seat,
    proposedTeam: g.proposed_team || [],
    rejectionCount: g.rejection_count,
    missionResults: missionRows.map((m) => ({
      missionNumber: m.mission_number,
      teamSize: m.team_size,
      failsRequired: m.fails_required,
      team: m.team_seats,
      result: m.result,
      failCount: m.fail_count,
    })),
    winner: g.winner,
    winReason: g.win_reason,
    assassinationTarget: g.assassination_target,
    hasAssassin: !!g.settings.assassin,
    hasLadyOfLake: !!g.settings.ladyOfLake,
    hasExcalibur: !!g.settings.excalibur,
    // Both tokens are physical props at the table in the rules this app
    // implements — who holds them is public, only what the holder learns
    // (a loyalty check, a peek at a mission's fail count) is private.
    ladyHolderSeat: g.settings.ladyOfLake ? g.lady_holder_seat : null,
    excaliburHolderSeat: g.settings.excalibur ? g.excalibur_holder_seat : null,
    excaliburUsed: g.excalibur_used,
  };

  if (g.phase === 'team_voting') {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS total, BOOL_OR(seat = $1) AS voted
         FROM team_votes WHERE game_id = $2 AND mission_number = $3 AND attempt = $4`,
      [seat, gameId, g.mission_number, g.rejection_count]
    );
    base.votesInSoFar = rows[0].total;
    base.hasVoted = !!rows[0].voted;
  }

  if (g.phase === 'mission') {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS total, BOOL_OR(seat = $1) AS played
         FROM mission_cards WHERE game_id = $2 AND mission_number = $3`,
      [seat, gameId, g.mission_number]
    );
    base.missionVotesInSoFar = rows[0].total;
    base.hasPlayedMissionCard = !!rows[0].played;
  }

  if (seat !== null && seat !== undefined) {
    const { rows: playerRows } = await pool.query(
      'SELECT role, team, knowledge FROM game_players WHERE game_id = $1 AND seat = $2',
      [gameId, seat]
    );
    const gp = playerRows[0];
    if (gp) {
      const you = {
        seat,
        role: ROLES[gp.role].name,
        roleId: gp.role,
        team: gp.team,
        description: ROLES[gp.role].description,
        knowledge: gp.knowledge,
      };

      if (g.settings.ladyOfLake) {
        const { rows: reveals } = await pool.query(
          `SELECT mission_number, target_seat, revealed_team
             FROM lady_of_lake_events WHERE game_id = $1 AND holder_seat = $2 ORDER BY mission_number`,
          [gameId, seat]
        );
        you.ladyOfLakeReveals = reveals.map((r) => ({
          missionNumber: r.mission_number,
          targetSeat: r.target_seat,
          team: r.revealed_team,
        }));
      }

      if (g.settings.excalibur && g.phase === 'excalibur_decision' && g.excalibur_holder_seat === seat) {
        you.excaliburPendingFailCount = g.pending_fail_count;
      }

      base.you = you;
    }
  }

  if (g.phase === 'game_over') {
    const { rows: reveal } = await pool.query(
      'SELECT seat, role, team FROM game_players WHERE game_id = $1 ORDER BY seat',
      [gameId]
    );
    base.reveal = reveal.map((r) => ({ seat: r.seat, roleId: r.role, role: ROLES[r.role].name, team: r.team }));
  }

  return base;
}

module.exports = {
  startGame,
  proposeTeam,
  castTeamVote,
  castMissionVote,
  excaliburDecision,
  useLadyOfLake,
  submitAssassination,
  loadGameStateForSeat,
};
