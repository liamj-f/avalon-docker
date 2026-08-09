const { GameError } = require('./game/roles');
const { saveFinishedGame } = require('./persistence');

function broadcastRoom(io, room) {
  for (const player of room.players.values()) {
    if (player.connected && player.socketId) {
      io.to(player.socketId).emit('room:state', room.serializeForToken(player.token));
    }
  }
}

function attachSocketHandlers(io, roomManager) {
  io.on('connection', (socket) => {
    let currentToken = null;

    const fail = (err) => {
      if (err instanceof GameError) {
        socket.emit('error', { message: err.message });
      } else {
        console.error('[socket] unexpected error:', err);
        socket.emit('error', { message: 'Something went wrong on the server.' });
      }
    };

    const withRoom = (handler) => (payload) => {
      try {
        if (!currentToken) throw new GameError('You are not in a room.');
        const found = roomManager.findByToken(currentToken);
        if (!found) throw new GameError('Room no longer exists.');
        handler(found.room, found.player, payload || {});
      } catch (err) {
        fail(err);
      }
    };

    socket.on('room:create', (payload = {}) => {
      try {
        const displayName = String(payload.displayName || '').trim();
        if (!displayName) throw new GameError('Enter a display name.');
        const { room, player } = roomManager.createRoom(displayName);
        player.connected = true;
        player.socketId = socket.id;
        currentToken = player.token;
        socket.emit('room:joined', { token: player.token, code: room.code });
        broadcastRoom(io, room);
      } catch (err) {
        fail(err);
      }
    });

    socket.on('room:join', (payload = {}) => {
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
        broadcastRoom(io, room);
      } catch (err) {
        fail(err);
      }
    });

    socket.on('room:rejoin', (payload = {}) => {
      try {
        const token = String(payload.token || '');
        const found = roomManager.findByToken(token);
        if (!found) throw new GameError('That session is no longer valid.');
        found.player.connected = true;
        found.player.socketId = socket.id;
        currentToken = token;
        socket.emit('room:joined', { token, code: found.room.code });
        broadcastRoom(io, found.room);
      } catch (err) {
        fail(err);
      }
    });

    socket.on(
      'room:updateSettings',
      withRoom((room, player, payload) => {
        room.updateSettings(player.token, payload.settings || {});
        broadcastRoom(io, room);
      })
    );

    socket.on(
      'room:start',
      withRoom((room, player) => {
        room.startGame(player.token);
        broadcastRoom(io, room);
      })
    );

    socket.on(
      'room:resetToLobby',
      withRoom((room, player) => {
        room.resetToLobby(player.token);
        broadcastRoom(io, room);
      })
    );

    socket.on(
      'room:leave',
      withRoom((room, player) => {
        roomManager.leaveRoom(player.token);
        currentToken = null;
        broadcastRoom(io, room);
      })
    );

    socket.on(
      'game:proposeTeam',
      withRoom((room, player, payload) => {
        const seats = Array.isArray(payload.seats) ? payload.seats.map(Number) : [];
        room.game.proposeTeam(player.seatIndex, seats);
        broadcastRoom(io, room);
      })
    );

    socket.on(
      'game:submitTeamVote',
      withRoom((room, player, payload) => {
        room.game.submitTeamVote(player.seatIndex, !!payload.approve);
        broadcastRoom(io, room);
      })
    );

    socket.on(
      'game:submitMissionVote',
      withRoom(async (room, player, payload) => {
        room.game.submitMissionVote(player.seatIndex, !!payload.success);
        broadcastRoom(io, room);
        if (room.game.phase === 'game_over') {
          await saveFinishedGame(room);
        }
      })
    );

    socket.on(
      'game:submitAssassination',
      withRoom(async (room, player, payload) => {
        room.game.submitAssassination(player.seatIndex, Number(payload.targetSeat));
        broadcastRoom(io, room);
        if (room.game.phase === 'game_over') {
          await saveFinishedGame(room);
        }
      })
    );

    socket.on(
      'chat:send',
      withRoom((room, player, payload) => {
        const message = String(payload.message || '').trim();
        if (!message) return;
        room.addChatMessage(player.displayName, message);
        broadcastRoom(io, room);
      })
    );

    socket.on('disconnect', () => {
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
      broadcastRoom(io, found.room);
    });
  });
}

module.exports = { attachSocketHandlers, broadcastRoom };
