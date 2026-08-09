require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const { waitForDb, runMigrations } = require('./db');
const { RoomManager } = require('./rooms');
const { attachSocketHandlers, broadcastRoom } = require('./socketHandlers');
const { attachGameListener } = require('./gameNotify');

const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

async function main() {
  console.log('[server] waiting for Postgres...');
  await waitForDb();
  console.log('[server] running migrations...');
  await runMigrations();

  const app = express();
  app.use(cors({ origin: CORS_ORIGIN }));
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  const roomManager = new RoomManager();

  app.get('/api/rooms/:code/exists', (req, res) => {
    const room = roomManager.rooms.get(req.params.code.toUpperCase());
    res.json({ exists: !!room, phase: room ? room.phase : null });
  });

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] },
  });

  attachSocketHandlers(io, roomManager);

  // Bridges Postgres back to the sockets: any stored procedure that mutates
  // a game ends with pg_notify(...), whether it was called by the app or by
  // hand from psql, and this pushes the resulting state to everyone in that
  // game's room.
  attachGameListener(async (gameId) => {
    const room = roomManager.findRoomByGameId(gameId);
    if (room) await broadcastRoom(io, room);
  });

  setInterval(() => roomManager.reapEmptyRooms(), 1000 * 60 * 30);

  server.listen(PORT, () => {
    console.log(`[server] Avalon backend listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('[server] fatal startup error:', err);
  process.exit(1);
});
