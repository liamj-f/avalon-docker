const { GameError } = require('./game/roles');
const gameDb = require('./gameDb');

// Several things can trigger a broadcast for the same room in quick
// succession — e.g. three players submitting mission cards within
// milliseconds of each other fires a direct post-mutation broadcast per
// socket handler PLUS a pg_notify-triggered one for each underlying DB
// change. Each broadcast reads fresh state with its own round-trip of
// SELECTs, so nothing stops two of them from being in flight at once and
// completing (and therefore emitting to clients) out of order — a slower
// broadcast for an earlier mutation finishing after a faster one for a
// later mutation would overwrite clients' state with stale data. Chaining
// every broadcast for a room onto a single promise queue forces them to run
// one at a time, in call order, so each one is guaranteed to read state at
// least as fresh as the one before it and always emits after it.
const broadcastChains = new Map(); // room code -> tail promise

async function broadcastRoom(io, room) {
  const prior = broadcastChains.get(room.code) || Promise.resolve();
  const next = prior.then(() => doBroadcast(io, room), () => doBroadcast(io, room));
  broadcastChains.set(room.code, next);
  return next;
}

async function doBroadcast(io, room) {
  const targets = Array.from(room.players.values()).filter((p) => p.connected && p.socketId);
  await Promise.all(
    targets.map(async (player) => {
      try {
        const state = await room.serializeForToken(player.token);
        io.to(player.socketId).emit('room:state', state);
      } catch (err) {
        console.error(`[socket] failed to build state for ${player.displayName}:`, err);
      }
    })
  );
}

function attachSocketHandlers(io, roomManager) {
  io.on('connection', (socket) => {
    let currentToken = null;

    const fail = (err) => {
      if (err instanceof GameError) {
        socket.emit('error', { message: err.message });
      } else if (err && typeof err.message === 'string' && err.message) {
        // Errors raised from Postgres stored procedures (RAISE EXCEPTION)
        // surface here with a clean, user-facing message already.
        socket.emit('error', { message: err.message });
      } else {
        console.error('[socket] unexpected error:', err);
        socket.emit('error', { message: 'Something went wrong on the server.' });
      }
    };

    const withRoom = (handler) => async (payload) => {
      try {
        if (!currentToken) throw new GameError('You are not in a room.');
        const found = roomManager.findByToken(currentToken);
        if (!found) throw new GameError('Room no longer exists.');
        await handler(found.room, found.player, payload || {});
      } catch (err) {
        fail(err);
      }
    };

    socket.on('room:create', async (payload = {}) => {
      try {
        const displayName = String(payload.displayName || '').trim();
        if (!displayName) throw new GameError('Enter a display name.');
        const { room, player } = roomManager.createRoom(displayName);
        player.connected = true;
        player.socketId = socket.id;
        currentToken = player.token;
        socket.emit('room:joined', { token: player.token, code: room.code });
        await broadcastRoom(io, room);
      } catch (err) {
        fail(err);
      }
    });

    socket.on('room:join', async (payload = {}) => {
      try {
        const displayName = String(payload.displayName || '').trim();
        const code = String(payload.code || '').trim();
        if (!displayName) throw new GameError('Enter a display name.');
        if (!code) throw new GameError('Enter a room code.');
        const { room, player } = roomManager.joinRoom(code, displayName);
        player.connected = true;
        player.socketId = socket.id;
        currentToken = player.token;
        socket.emit('room:joined', { token: player.token, code: room.code });
        await broadcastRoom(io, room);
      } catch (err) {
        fail(err);
      }
    });

    socket.on('room:rejoin', async (payload = {}) => {
      try {
        const token = String(payload.token || '');
        const found = roomManager.findByToken(token);
        if (!found) throw new GameError('That session is no longer valid.');
        found.player.connected = true;
        found.player.socketId = socket.id;
        currentToken = token;
        socket.emit('room:joined', { token, code: found.room.code });
        await broadcastRoom(io, found.room);
      } catch (err) {
        fail(err);
      }
    });

    socket.on(
      'room:updateSettings',
      withRoom(async (room, player, payload) => {
        room.updateSettings(player.token, payload.settings || {});
        await broadcastRoom(io, room);
      })
    );

    socket.on(
      'room:setRolePreference',
      withRoom(async (room, player, payload) => {
        room.setRolePreference(player.token, payload.key, !!payload.want);
        await broadcastRoom(io, room);
      })
    );

    socket.on(
      'room:transferHost',
      withRoom(async (room, player, payload) => {
        room.transferHost(player.token, Number(payload.targetSeat));
        await broadcastRoom(io, room);
      })
    );

    socket.on(
      'room:start',
      withRoom(async (room, player) => {
        const gameId = await room.startGame(player.token);
        roomManager.registerGame(gameId, room.code);
        await broadcastRoom(io, room);
      })
    );

    socket.on(
      'room:resetToLobby',
      withRoom(async (room, player) => {
        room.resetToLobby(player.token);
        await broadcastRoom(io, room);
      })
    );

    socket.on(
      'room:leave',
      withRoom(async (room, player) => {
        roomManager.leaveRoom(player.token);
        currentToken = null;
        await broadcastRoom(io, room);
      })
    );

    socket.on(
      'game:proposeTeam',
      withRoom(async (room, player, payload) => {
        const seats = Array.isArray(payload.seats) ? payload.seats.map(Number) : [];
        await gameDb.proposeTeam(room.gameId, player.seatIndex, seats);
        await broadcastRoom(io, room); // NOTIFY will also fire; this just keeps the actor's own UI snappy
      })
    );

    socket.on(
      'game:submitTeamVote',
      withRoom(async (room, player, payload) => {
        await gameDb.castTeamVote(room.gameId, player.seatIndex, !!payload.approve);
        await broadcastRoom(io, room);
      })
    );

    socket.on(
      'game:submitMissionVote',
      withRoom(async (room, player, payload) => {
        await gameDb.castMissionVote(room.gameId, player.seatIndex, !!payload.success);
        await broadcastRoom(io, room);
      })
    );

    socket.on(
      'game:excaliburDecision',
      withRoom(async (room, player, payload) => {
        await gameDb.excaliburDecision(room.gameId, player.seatIndex, !!payload.use);
        await broadcastRoom(io, room);
      })
    );

    socket.on(
      'game:useLadyOfLake',
      withRoom(async (room, player, payload) => {
        await gameDb.useLadyOfLake(room.gameId, player.seatIndex, Number(payload.targetSeat));
        await broadcastRoom(io, room);
      })
    );

    socket.on(
      'game:submitAssassination',
      withRoom(async (room, player, payload) => {
        await gameDb.submitAssassination(room.gameId, player.seatIndex, Number(payload.targetSeat));
        await broadcastRoom(io, room);
      })
    );

    socket.on(
      'chat:send',
      withRoom(async (room, player, payload) => {
        const message = String(payload.message || '').trim();
        if (!message) return;
        room.addChatMessage(player.displayName, message);
        await broadcastRoom(io, room);
      })
    );

    socket.on('disconnect', async () => {
      if (!currentToken) return;
      const found = roomManager.findByToken(currentToken);
      if (!found) return;
      found.player.connected = false;
      found.player.socketId = null;
      if (found.room.phase === 'lobby') {
        // In the lobby, a disconnect is treated as leaving outright so seats
        // don't pile up with ghosts before a game has even started.
        roomManager.leaveRoom(currentToken);
      }
      await broadcastRoom(io, found.room);
    });
  });
}

module.exports = { attachSocketHandlers, broadcastRoom };
