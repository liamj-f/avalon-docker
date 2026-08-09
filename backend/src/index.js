require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const { waitForDb, runMigrations } = require('./db');
const { RoomManager } = require('./rooms');
const { attachSocketHandlers } = require('./socketHandlers');

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

  setInterval(() => roomManager.reapEmptyRooms(), 1000 * 60 * 30);

  server.listen(PORT, () => {
    console.log(`[server] Avalon backend listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('[server] fatal startup error:', err);
  process.exit(1);
});
