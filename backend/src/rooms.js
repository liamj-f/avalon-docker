const crypto = require('crypto');
const { generateUniqueCode } = require('./utils/roomCode');
const { GameError, defaultSettings, validateSettings, assignRoles, computeKnowledge } = require('./game/roles');
const { MIN_PLAYERS, MAX_PLAYERS } = require('./game/config');
const gameDb = require('./gameDb');

const MAX_CHAT_HISTORY = 200;

// Every settings key a player can cast a lobby preference vote on. The vote
// is purely advisory — see Room.serializeForToken — the host's own toggle
// is what actually gets used when the game starts.
const VOTABLE_KEYS = ['merlin', 'percival', 'morgana', 'mordred', 'oberon', 'assassin', 'tristanIseult', 'ladyOfLake', 'excalibur'];

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map(); // token -> player
    this.nextSeatIndex = 0;
    this.settings = defaultSettings();
    this.rolePreferences = new Map(); // roleKey -> Set<seat> of players who want it
    this.phase = 'lobby'; // 'lobby' | 'in_game'
    this.gameId = null; // Postgres games.id once a game has started
    this.chat = [];
    this.hostToken = null;
    this.createdAt = new Date();
  }

  get playerList() {
    return Array.from(this.players.values()).sort((a, b) => a.seatIndex - b.seatIndex);
  }

  addPlayer(displayName, { asHost = false } = {}) {
    if (this.phase !== 'lobby') throw new GameError('This game has already started.');
    if (this.players.size >= MAX_PLAYERS) throw new GameError(`Room is full (max ${MAX_PLAYERS} players).`);

    const token = crypto.randomUUID();
    const player = {
      token,
      seatIndex: this.nextSeatIndex,
      displayName: displayName.slice(0, 30),
      socketId: null,
      connected: false,
      isHost: asHost,
    };
    this.nextSeatIndex += 1;
    this.players.set(token, player);
    if (asHost) this.hostToken = token;
    return player;
  }

  removePlayer(token) {
    if (this.phase === 'lobby') {
      const wasHost = this.hostToken === token;
      const removed = this.players.get(token);
      this.players.delete(token);
      if (removed) {
        for (const voters of this.rolePreferences.values()) voters.delete(removed.seatIndex);
      }
      if (wasHost && this.players.size > 0) {
        const next = this.playerList[0];
        next.isHost = true;
        this.hostToken = next.token;
      }
    } else {
      const player = this.players.get(token);
      if (player) player.connected = false;
    }
  }

  isEmpty() {
    if (this.players.size === 0) return true;
    return this.playerList.every((p) => !p.connected);
  }

  updateSettings(token, settings) {
    if (this.phase !== 'lobby') throw new GameError('Cannot change roles once the game has started.');
    if (token !== this.hostToken) throw new GameError('Only the host can change role settings.');
    this.settings = { ...this.settings, ...settings };
  }

  /** Non-binding preference poll: any player can say which roles they'd like to see. */
  setRolePreference(token, key, want) {
    if (this.phase !== 'lobby') throw new GameError('Voting is only available in the lobby.');
    if (!VOTABLE_KEYS.includes(key)) throw new GameError('Unknown role.');
    const player = this.players.get(token);
    if (!player) throw new GameError('You are not in this room.');
    if (!this.rolePreferences.has(key)) this.rolePreferences.set(key, new Set());
    const voters = this.rolePreferences.get(key);
    if (want) voters.add(player.seatIndex);
    else voters.delete(player.seatIndex);
  }

  transferHost(token, targetSeat) {
    if (this.phase !== 'lobby') throw new GameError('Cannot transfer host once the game has started.');
    if (token !== this.hostToken) throw new GameError('Only the current host can transfer host.');
    const target = this.playerList.find((p) => p.seatIndex === targetSeat);
    if (!target) throw new GameError('That player is not in this room.');
    if (target.token === token) return;
    const current = this.players.get(token);
    if (current) current.isHost = false;
    target.isHost = true;
    this.hostToken = target.token;
  }

  validateStart(token) {
    if (token !== this.hostToken) throw new GameError('Only the host can start the game.');
    if (this.phase !== 'lobby') throw new GameError('Game already in progress.');
    const count = this.players.size;
    if (count < MIN_PLAYERS) throw new GameError(`Need at least ${MIN_PLAYERS} players to start (have ${count}).`);
    if (count > MAX_PLAYERS) throw new GameError(`Too many players (max ${MAX_PLAYERS}).`);
    const errors = validateSettings(count, this.settings);
    if (errors.length) throw new GameError(errors.join(' '));
  }

  async startGame(token) {
    this.validateStart(token);

    const seats = this.playerList.map((p) => p.seatIndex);
    const assignments = assignRoles(seats, this.settings);
    const knowledge = computeKnowledge(assignments);
    const displayNames = new Map(this.playerList.map((p) => [p.seatIndex, p.displayName]));

    const leaderSeat = seats[Math.floor(Math.random() * seats.length)];

    // Lady of the Lake can start with anyone (that's the real rule — even
    // Evil can hold and use it). Excalibur is Arthur's sword, so it only
    // ever starts with a Good player.
    const ladyHolderSeat = this.settings.ladyOfLake ? seats[Math.floor(Math.random() * seats.length)] : null;
    const goodSeats = assignments.filter((a) => a.team === 'good').map((a) => a.seat);
    const excaliburHolderSeat = this.settings.excalibur ? goodSeats[Math.floor(Math.random() * goodSeats.length)] : null;

    const players = assignments.map((a) => ({
      seat: a.seat,
      displayName: displayNames.get(a.seat),
      roleId: a.roleId,
      team: a.team,
      knowledge: knowledge.get(a.seat) || [],
    }));

    this.gameId = await gameDb.startGame({
      roomCode: this.code,
      settings: this.settings,
      seatOrder: seats,
      leaderSeat,
      ladyHolderSeat,
      excaliburHolderSeat,
      players,
    });
    this.phase = 'in_game';
    return this.gameId;
  }

  /** Returns the lobby back to a fresh state, keeping the same players/room. The finished game's row stays in Postgres for history. */
  resetToLobby(token) {
    if (token !== this.hostToken) throw new GameError('Only the host can return to the lobby.');
    const finishedGameId = this.gameId;
    this.phase = 'lobby';
    this.gameId = null;
    return finishedGameId;
  }

  addChatMessage(displayName, message) {
    const entry = {
      displayName,
      message: String(message).slice(0, 500),
      at: Date.now(),
    };
    this.chat.push(entry);
    if (this.chat.length > MAX_CHAT_HISTORY) this.chat.shift();
    return entry;
  }

  async serializeForToken(token) {
    const player = this.players.get(token);
    const seat = player ? player.seatIndex : null;

    const rolePreferenceTally = {};
    for (const key of VOTABLE_KEYS) {
      const voters = this.rolePreferences.get(key);
      rolePreferenceTally[key] = {
        count: voters ? voters.size : 0,
        you: !!(voters && seat !== null && voters.has(seat)),
      };
    }

    return {
      code: this.code,
      phase: this.phase,
      settings: this.settings,
      rolePreferenceTally,
      you: player
        ? { seat, displayName: player.displayName, isHost: player.isHost, token: player.token }
        : null,
      players: this.playerList.map((p) => ({
        seat: p.seatIndex,
        displayName: p.displayName,
        isHost: p.isHost,
        connected: p.connected,
      })),
      chat: this.chat,
      game: this.phase === 'in_game' && this.gameId ? await gameDb.loadGameStateForSeat(this.gameId, seat) : null,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
    };
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map(); // code -> Room
    this.tokenToCode = new Map(); // token -> room code
    this.gameIdToCode = new Map(); // Postgres games.id -> room code, for the NOTIFY listener
  }

  createRoom(displayName) {
    const code = generateUniqueCode(new Set(this.rooms.keys()));
    const room = new Room(code);
    const player = room.addPlayer(displayName, { asHost: true });
    this.rooms.set(code, room);
    this.tokenToCode.set(player.token, code);
    return { room, player };
  }

  joinRoom(code, displayName) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) throw new GameError('Room not found. Check the code and try again.');
    const player = room.addPlayer(displayName);
    this.tokenToCode.set(player.token, room.code);
    return { room, player };
  }

  findByToken(token) {
    const code = this.tokenToCode.get(token);
    if (!code) return null;
    const room = this.rooms.get(code);
    if (!room) return null;
    const player = room.players.get(token);
    if (!player) return null;
    return { room, player };
  }

  findRoomByGameId(gameId) {
    const code = this.gameIdToCode.get(gameId);
    return code ? this.rooms.get(code) : null;
  }

  registerGame(gameId, roomCode) {
    this.gameIdToCode.set(gameId, roomCode);
  }

  leaveRoom(token) {
    const found = this.findByToken(token);
    if (!found) return;
    const { room } = found;
    room.removePlayer(token);
    this.tokenToCode.delete(token);
    if (room.isEmpty()) {
      this.rooms.delete(room.code);
    }
  }

  reapEmptyRooms(maxAgeMs = 1000 * 60 * 60 * 6) {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      if (room.isEmpty() && now - room.createdAt.getTime() > maxAgeMs) {
        this.rooms.delete(code);
      }
    }
  }
}

module.exports = { RoomManager, Room, VOTABLE_KEYS };
