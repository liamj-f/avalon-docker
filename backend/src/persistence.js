const { pool } = require('./db');
const { ROLES } = require('./game/roles');

/**
 * Persists a finished game to Postgres for history purposes. Best-effort:
 * failures are logged but never interrupt gameplay, since the live game
 * state lives entirely in memory and has already resolved by this point.
 */
async function saveFinishedGame(room) {
  const game = room.game;
  if (!game || game.phase !== 'game_over') return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const gameRes = await client.query(
      `INSERT INTO games (room_code, player_count, roles_config, started_at, ended_at, winning_team, win_reason)
       VALUES ($1, $2, $3, $4, now(), $5, $6)
       RETURNING id`,
      [
        room.code,
        game.assignments.length,
        JSON.stringify(room.settings),
        game.createdAt,
        game.winner,
        game.winReason,
      ]
    );
    const gameId = gameRes.rows[0].id;

    for (const a of game.assignments) {
      await client.query(
        `INSERT INTO game_players (game_id, seat, display_name, role, team, was_assassinated)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          gameId,
          a.seat,
          game.displayNames.get(a.seat) || `Seat ${a.seat}`,
          ROLES[a.roleId].name,
          a.team,
          game.assassinationTarget === a.seat,
        ]
      );
    }

    for (const m of game.missionResults) {
      await client.query(
        `INSERT INTO game_missions (game_id, mission_number, team_size, fails_required, team_seats, result, fail_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [gameId, m.missionNumber, m.teamSize, m.failsRequired, JSON.stringify(m.team), m.result, m.failCount]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[persistence] failed to save finished game:', err.message);
  } finally {
    client.release();
  }
}

module.exports = { saveFinishedGame };
