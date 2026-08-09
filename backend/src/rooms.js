const crypto = require('crypto');
const { generateUniqueCode } = require('./utils/roomCode');
const { GameError, defaultSettings, validateSettings } = require('./game/roles');
const { AvalonGame } = require('./game/engine');
const { MIN_PLAYERS, MAX_PLAYERS } = require('./game/config');

const MAX_CHAT_HISTORY = 200;

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map(); // token -> player
    this.nextSeatIndex = 0;
    this.settings = defaultSettings();
    this.phase = 'lobby'; // 'lobby' | 'in_game'
    this.game = null;
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
      this.players.delete(token);
      if (wasHost && this.players.size > 0) {
        // Hand host duties to the longest-standing remaining player.
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

  validateStart(token) {
    if (token !== this.hostToken) throw new GameError('Only the host can start the game.');
    if (this.phase !== 'lobby') throw new GameError('Game already in progress.');
    const count = this.players.size;
    if (count < MIN_PLAYERS) throw new GameError(`Need at least ${MIN_PLAYERS} players to start (have ${count}).`);
    if (count > MAX_PLAYERS) throw new GameError(`Too many players (max ${MAX_PLAYERS}).`);
    const errors = validateSettings(count, this.settings);
    if (errors.length) throw new GameError(errors.join(' '));
  }

  startGame(token) {
    this.validateStart(token);
    const seats = this.playerList.map((p) => p.seatIndex);
    const displayNames = new Map(this.playerList.map((p) => [p.seatIndex, p.displayName]));
    this.game = new AvalonGame(seats, this.settings, displayNames);
    this.phase = 'in_game';
    return this.game;
  }

  /** Returns the lobby back to a fresh state, keeping the same players/room. */
  resetToLobby(token) {
    if (token !== this.hostToken) throw new GameError('Only the host can return to the lobby.');
    this.phase = 'lobby';
    this.game = null;
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

  serializeForToken(token) {
    const player = this.players.get(token);
    const seat = player ? player.seatIndex : null;
    return {
      code: this.code,
      phase: this.phase,
      settings: this.settings,
      hostToken: undefined, // never leak tokens
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
      game: this.game ? this.game.serializeForSeat(seat) : null,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
    };
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map(); // code -> Room
    this.tokenToCode = new Map(); // token -> room code
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

module.exports = { RoomManager, Room };
