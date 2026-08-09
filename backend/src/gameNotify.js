const { Client } = require('pg');

/**
 * Keeps a dedicated LISTEN connection open on 'avalon_game_updates'. Every
 * stored procedure that mutates a game ends with pg_notify(...), so this
 * fires whenever a game changes — whether that change came from a player's
 * socket action or from someone running `SELECT sp_...(...)` by hand in
 * psql. Either way, `onGameChanged(gameId)` re-broadcasts fresh state to
 * that game's room.
 */
function attachGameListener(onGameChanged) {
  let client;
  let stopped = false;

  async function connect() {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    client.on('error', (err) => {
      console.error('[gameNotify] listener connection error:', err.message);
    });
    client.on('end', () => {
      if (!stopped) {
        console.log('[gameNotify] listener disconnected, reconnecting in 2s...');
        setTimeout(connect, 2000);
      }
    });
    client.on('notification', (msg) => {
      if (msg.channel !== 'avalon_game_updates') return;
      Promise.resolve(onGameChanged(msg.payload)).catch((err) => {
        console.error('[gameNotify] error handling notification:', err);
      });
    });

    await client.connect();
    await client.query('LISTEN avalon_game_updates');
    console.log('[gameNotify] listening for game updates');
  }

  connect().catch((err) => {
    console.error('[gameNotify] failed to establish listener, retrying in 2s:', err.message);
    setTimeout(connect, 2000);
  });

  return {
    stop: async () => {
      stopped = true;
      if (client) await client.end().catch(() => {});
    },
  };
}

module.exports = { attachGameListener };
