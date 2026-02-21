/**
 * GAME ROOM — server-side room management and game loop.
 * Server-authoritative: validates every move, broadcasts state at 20 ticks/sec.
 */

'use strict';

const { MazeGenerator, getMazeSizeForLevel, getExtraOpeningsForLevel } = require('./maze-generator');
const { applyEffect, tickEffects } = require('./powerups');
const { AiBot } = require('./ai-bot');

// stats is injected after DB init to avoid circular startup issues
let stats = null;
function setStats(s) { stats = s; }

const TICK_RATE  = 20;           // ticks per second
const TICK_MS    = 1000 / TICK_RATE; // 50 ms
const MOVE_GRACE = 30;           // ms tolerance for rate limiting

// ─── Room Code Generator ─────────────────────────────────────────────────────
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusable chars

function genCode() {
  let c = '';
  for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

// ─── Room ────────────────────────────────────────────────────────────────────
class Room {
  constructor(io, code, level = 1) {
    this.io           = io;
    this.code         = code;
    this.level        = Math.max(1, Math.min(10, level));
    this.players      = [];         // max 2
    this.state        = 'waiting';  // waiting|countdown|playing|finished
    this.maze         = null;
    this.powerups     = [];         // server-authoritative powerup state
    this.seed         = null;
    this.tickId       = null;
    this.tick         = 0;
    this.startTime    = null;
    this.createdAt    = Date.now();
    this.lastActivity = Date.now();
    this.rematchVotes = new Set();
  }

  // ── Players ────────────────────────────────────────────────────────────────

  get isFull()  { return this.players.length >= 2; }
  get isEmpty() { return this.players.length === 0; }

  addPlayer(socket, name) {
    if (this.isFull)              return { ok: false, error: 'Room is full' };
    if (this.state !== 'waiting') return { ok: false, error: 'Game already in progress' };

    const player = {
      socket,
      id:                socket.id,
      name:              (name || 'GHOST').slice(0, 16).toUpperCase(),
      x:                 0,
      y:                 0,
      ready:             false,
      effects:           { speed_boost: 0, freeze: 0 },
      powerupsHeld:      [],
      moveSpeed:         150,   // ms per cell
      lastMoveTime:      0,
      finishTime:        null,
      powerupsCollected: 0,
      freezesUsed:       0,
    };

    this.players.push(player);
    socket.join(this.code);
    this.lastActivity = Date.now();
    return { ok: true, player };
  }

  removePlayer(socketId) {
    const idx = this.players.findIndex(p => p.id === socketId);
    if (idx < 0) return;

    this.players.splice(idx, 1);
    this.lastActivity = Date.now();

    if (this.state === 'playing' || this.state === 'countdown') {
      this._stopTick();
      this.state = 'waiting';
      const remaining = this.players[0];
      if (remaining) {
        remaining.socket.emit('opponent-disconnected', {});
      }
    }
  }

  // ── Ready ──────────────────────────────────────────────────────────────────

  markReady(socketId) {
    const p = this.players.find(p => p.id === socketId);
    if (!p || p.ready) return;
    p.ready = true;
    this.lastActivity = Date.now();

    if (this.players.length === 2 && this.players.every(p => p.ready)) {
      this._startGame();
    }
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  processInput(socketId, direction, seq) {
    if (this.state !== 'playing') return;

    const player = this.players.find(p => p.id === socketId);
    if (!player) return;

    // Frozen — reject all moves
    if (player.effects.freeze > 0) {
      player.socket.emit('move-rejected', {
        seq,
        correctPosition: { x: player.x, y: player.y },
      });
      return;
    }

    const now = Date.now();

    // Rate limiting — prevent speed hacks (respects speed_boost via moveSpeed)
    if (now - player.lastMoveTime < player.moveSpeed - MOVE_GRACE) {
      player.socket.emit('move-rejected', {
        seq,
        correctPosition: { x: player.x, y: player.y },
      });
      return;
    }

    // Validate direction
    const DIRS = { n: [0,-1], s: [0,1], e: [1,0], w: [-1,0] };
    if (!DIRS[direction]) return;

    // Wall check
    const cell = this.maze.cells[player.y * this.maze.width + player.x];
    if (!cell || cell.walls[direction]) {
      player.socket.emit('move-rejected', {
        seq,
        correctPosition: { x: player.x, y: player.y },
      });
      return;
    }

    const [dx, dy] = DIRS[direction];
    const nx = player.x + dx;
    const ny = player.y + dy;

    if (nx < 0 || nx >= this.maze.width || ny < 0 || ny >= this.maze.height) {
      player.socket.emit('move-rejected', {
        seq,
        correctPosition: { x: player.x, y: player.y },
      });
      return;
    }

    player.x = nx;
    player.y = ny;
    player.lastMoveTime = now;
    this.lastActivity   = now;

    player.socket.emit('move-confirmed', {
      seq,
      position: { x: nx, y: ny },
    });

    // Check powerup collection
    const pu = this.powerups.find(p => !p.collected && p.x === nx && p.y === ny);
    if (pu) {
      pu.collected = true;
      player.powerupsHeld.push(pu.type);
      player.powerupsCollected++;
      this.io.to(this.code).emit('powerup-collected', {
        playerId:  player.id,
        powerupId: pu.id,
        type:      pu.type,
      });
    }

    // Win condition
    if (nx === this.maze.exit.x && ny === this.maze.exit.y) {
      this._handleWin(player.id);
    }
  }

  // ── Powerup Use ────────────────────────────────────────────────────────────

  processPowerupUse(socketId, powerupType) {
    if (this.state !== 'playing') return;

    const player = this.players.find(p => p.id === socketId);
    if (!player) return;

    const idx = player.powerupsHeld.indexOf(powerupType);
    if (idx < 0) return; // player doesn't have this powerup

    player.powerupsHeld.splice(idx, 1);

    if (powerupType === 'speed_boost') {
      applyEffect(player, 'speed_boost');
      this.io.to(this.code).emit('powerup-activated', {
        playerId: player.id,
        type:     powerupType,
        targetId: player.id,
      });

    } else if (powerupType === 'freeze') {
      const target = this.players.find(p => p.id !== socketId);
      if (target) {
        player.freezesUsed++;
        applyEffect(player, 'freeze', target);
        this.io.to(this.code).emit('powerup-activated', {
          playerId: player.id,
          type:     powerupType,
          targetId: target.id,
        });
        this.io.to(this.code).emit('player-frozen', {
          playerId: target.id,
          duration: target.effects.freeze,
        });
      }
    }
  }

  // ── Rematch ────────────────────────────────────────────────────────────────

  voteRematch(socketId) {
    if (this.state !== 'finished') return;
    this.rematchVotes.add(socketId);

    if (this.rematchVotes.size >= this.players.length) {
      this._resetForRematch();
    } else {
      this.io.to(this.code).emit('rematch-vote', {
        votes:  this.rematchVotes.size,
        needed: this.players.length,
      });
    }
  }

  // ── Game Flow ──────────────────────────────────────────────────────────────

  _startGame() {
    this.state = 'countdown';
    this.seed  = Math.floor(Math.random() * 0xFFFFFFF);
    const extra         = getExtraOpeningsForLevel(this.level);
    const { width, height } = getMazeSizeForLevel(this.level);

    const gen   = new MazeGenerator(width, height, this.seed);
    this.maze   = gen.generate(extra);

    // Clone powerups for server-authoritative tracking
    this.powerups = this.maze.powerups.map(p => ({ ...p, collected: false }));

    // Place both players at start, reset per-game state
    this.players.forEach(p => {
      p.x                 = this.maze.start.x;
      p.y                 = this.maze.start.y;
      p.finishTime        = null;
      p.lastMoveTime      = 0;
      p.effects           = { speed_boost: 0, freeze: 0 };
      p.powerupsHeld      = [];
      p.moveSpeed         = 150;
      p.powerupsCollected = 0;
      p.freezesUsed       = 0;
    });

    // Send game-start — clients regenerate maze from seed; external bots also get full maze data
    this.players.forEach((player, i) => {
      const opp     = this.players[1 - i];
      const payload = {
        seed:             this.seed,
        level:            this.level,
        extraOpenings:    extra,
        yourId:           player.id,
        yourPosition:     { x: player.x, y: player.y },
        opponentPosition: opp ? { x: opp.x, y: opp.y } : null,
        opponentName:     opp ? opp.name : null,
      };
      // External AI bots receive the full maze so they don't need client-side regeneration
      if (player.socket.data?.isExternalBot) payload.maze = this.maze;
      player.socket.emit('game-start', payload);
    });

    // Wait for client countdown before accepting moves
    setTimeout(() => {
      if (this.state !== 'countdown') return;
      this.state     = 'playing';
      this.startTime = Date.now();
      this.tick      = 0;
      this._startTick();
    }, 3600);
  }

  _startTick() {
    this.tickId = setInterval(() => this._tick(), TICK_MS);
  }

  _stopTick() {
    if (this.tickId) { clearInterval(this.tickId); this.tickId = null; }
  }

  _tick() {
    this.tick++;
    const elapsed = Date.now() - this.startTime;

    // Tick effects for all players
    this.players.forEach(p => tickEffects(p, TICK_MS));

    this.io.to(this.code).emit('game-state', {
      tick:    this.tick,
      elapsed,
      players: this.players.map(p => ({
        id:           p.id,
        x:            p.x,
        y:            p.y,
        effects:      { ...p.effects },
        powerupsHeld: [...p.powerupsHeld],
      })),
      powerups: this.powerups,
    });
  }

  _handleWin(winnerId) {
    if (this.state !== 'playing') return;
    this.state = 'finished';
    this._stopTick();

    const elapsed = Date.now() - this.startTime;
    const winner  = this.players.find(p => p.id === winnerId);
    if (winner) winner.finishTime = elapsed;

    // Record to database and compute ELO changes (skip for built-in bot games)
    const hasBuiltInBot = this.players.some(p => p.socket._isBot);
    let eloChanges = {};
    let newElos    = {};
    if (stats && this.players.length === 2 && !hasBuiltInBot) {
      try {
        const [p1, p2] = this.players;
        const result = stats.recordVSMatch(
          p1.name, p2.name,
          p1.id === winnerId ? p1.name : p2.name, // pass winner name
          this.level,
          p1.finishTime, p2.finishTime,
          { powerupsCollected: p1.powerupsCollected, freezesUsed: p1.freezesUsed },
          { powerupsCollected: p2.powerupsCollected, freezesUsed: p2.freezesUsed },
        );
        // remap from DB player IDs to socket IDs for the client
        const idMap = result.playerIds;
        eloChanges[p1.id] = result.eloChanges[idMap.p1];
        eloChanges[p2.id] = result.eloChanges[idMap.p2];
        newElos[p1.id]    = result.newElos[idMap.p1];
        newElos[p2.id]    = result.newElos[idMap.p2];
      } catch (err) {
        console.error('Stats record error:', err.message);
      }
    }

    this.io.to(this.code).emit('game-over', {
      winnerId,
      stats: {
        elapsed,
        eloChanges,
        newElos,
        players: this.players.map(p => ({
          id:                p.id,
          name:              p.name,
          time:              p.finishTime,
          won:               p.id === winnerId,
          powerupsCollected: p.powerupsCollected,
          freezesUsed:       p.freezesUsed,
        })),
      },
    });

    console.log(`Room ${this.code}: ${winner ? winner.name : '?'} wins in ${(elapsed / 1000).toFixed(2)}s`);
  }

  _resetForRematch() {
    this.rematchVotes.clear();
    this.powerups = [];
    this.players.forEach(p => {
      p.ready             = false;
      p.effects           = { speed_boost: 0, freeze: 0 };
      p.powerupsHeld      = [];
      p.moveSpeed         = 150;
      p.powerupsCollected = 0;
      p.freezesUsed       = 0;
    });
    this.state = 'waiting';
    this.players.forEach((p, i) => {
      const opp = this.players[1 - i];
      p.socket.emit('rematch-ready', { opponentName: opp ? opp.name : null });
    });
    // Auto-mark ready so rematch starts immediately
    this.players.forEach(p => this.markReady(p.id));
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  get isExpired() {
    return this.isEmpty && (Date.now() - this.lastActivity > 5 * 60 * 1000);
  }

  destroy() {
    this._stopTick();
  }
}

// ─── Room Manager ─────────────────────────────────────────────────────────────
class RoomManager {
  constructor(io) {
    this.io    = io;
    this.rooms = new Map(); // code → Room
    this._matchmaking = null; // set after init via setMatchmaking()
    setInterval(() => this._cleanup(), 60 * 1000);
  }

  setMatchmaking(mm) {
    this._matchmaking = mm;
  }

  _makeCode() {
    let code;
    let attempts = 0;
    do {
      code = genCode();
      attempts++;
    } while (this.rooms.has(code) && attempts < 100);
    return code;
  }

  _cleanup() {
    for (const [code, room] of this.rooms) {
      if (room.isExpired) {
        room.destroy();
        this.rooms.delete(code);
        console.log(`Room ${code} expired`);
      }
    }
  }

  // ── Matchmade Room ─────────────────────────────────────────────────────────

  /**
   * Called by MatchmakingManager when two players are paired.
   * Creates a room, adds both sockets, sends match-found, auto-starts.
   */
  createMatchmadeRoom(a, b) {
    const code = this._makeCode();
    // Use an average level for matched rooms (1 = small; matchmaking always uses level 1 for speed)
    const room = new Room(this.io, code, 1);
    this.rooms.set(code, room);

    const rA = room.addPlayer(a.socket, a.playerName);
    const rB = room.addPlayer(b.socket, b.playerName);
    if (!rA.ok || !rB.ok) {
      room.destroy();
      this.rooms.delete(code);
      throw new Error('Failed to add matchmade players');
    }

    a.socket.data.roomCode = code;
    b.socket.data.roomCode = code;

    // Notify each player they've been matched
    a.socket.emit('match-found', { roomCode: code, opponent: { name: b.playerName, elo: b.elo } });
    b.socket.emit('match-found', { roomCode: code, opponent: { name: a.playerName, elo: a.elo } });

    // Auto-mark both ready → game starts after countdown
    room.players.forEach(p => room.markReady(p.id));
    console.log(`Matchmade: ${a.playerName} vs ${b.playerName} in room ${code}`);
  }

  // ── Bot Room ────────────────────────────────────────────────────────────────

  /**
   * Create a room with a human player vs a built-in AI bot.
   * Immediately starts the game (no ready-handshake needed).
   */
  createBotRoom(socket, playerName, difficulty, level) {
    const code = this._makeCode();
    const room = new Room(this.io, code, level || 1);
    this.rooms.set(code, room);

    const rHuman = room.addPlayer(socket, playerName);
    if (!rHuman.ok) {
      socket.emit('error', { message: rHuman.error });
      room.destroy();
      this.rooms.delete(code);
      return;
    }

    const bot = new AiBot(difficulty || 'medium');
    room.addPlayer(bot.socket, bot.name);
    bot.setRoom(room);

    socket.data.roomCode = code;

    // Notify human: opponent is the bot
    socket.emit('match-found', {
      roomCode: code,
      opponent: { name: bot.name, elo: 1000 },
      vsBot:    true,
      difficulty,
    });

    // Auto-mark both ready → countdown → game starts
    room.players.forEach(p => room.markReady(p.id));
    console.log(`Bot room ${code}: ${rHuman.player.name} vs ${bot.name} (${difficulty})`);
  }

  // ── Connection Handler ─────────────────────────────────────────────────────

  handleConnection(socket) {
    socket.data.roomCode = null;

    socket.on('create-room', ({ playerName, level = 1 } = {}) => {
      const code = this._makeCode();
      const room = new Room(this.io, code, level);
      this.rooms.set(code, room);

      const result = room.addPlayer(socket, playerName);
      if (!result.ok) {
        socket.emit('error', { message: result.error });
        return;
      }

      socket.data.roomCode = code;
      socket.emit('room-created', { roomCode: code, level });
      console.log(`Room ${code} created by ${result.player.name} (level ${level})`);
    });

    socket.on('join-room', ({ roomCode, playerName } = {}) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = this.rooms.get(code);

      if (!room) {
        socket.emit('error', { message: `Room "${code}" not found` });
        return;
      }
      if (room.isFull) {
        socket.emit('error', { message: 'Room is full' });
        return;
      }

      const result = room.addPlayer(socket, playerName);
      if (!result.ok) {
        socket.emit('error', { message: result.error });
        return;
      }

      socket.data.roomCode = code;

      const host = room.players.find(p => p.id !== socket.id);
      socket.emit('room-joined', {
        roomCode: code,
        level:    room.level,
        opponent: host ? { id: host.id, name: host.name } : null,
      });

      if (host) {
        host.socket.emit('opponent-joined', {
          opponent: { id: socket.id, name: result.player.name },
        });
      }

      console.log(`${result.player.name} joined room ${code}`);
    });

    socket.on('create-bot-room', ({ playerName, difficulty, level = 1 } = {}) => {
      if (socket.data.roomCode) return; // already in a room
      this.createBotRoom(socket, playerName, difficulty || 'medium', level);
    });

    socket.on('find-match', ({ playerName } = {}) => {
      if (socket.data.roomCode) return; // already in a room
      if (!this._matchmaking) {
        socket.emit('error', { message: 'Matchmaking unavailable' });
        return;
      }
      const name = (playerName || 'GHOST').slice(0, 16).toUpperCase();
      const elo  = stats ? stats.getPlayerElo(name) : 1000;
      socket.data.matchmaking = true;
      this._matchmaking.add(socket, name, elo);
    });

    socket.on('cancel-matchmaking', () => {
      if (this._matchmaking) this._matchmaking.remove(socket.id);
      socket.data.matchmaking = false;
      socket.emit('matchmaking-cancelled', {});
    });

    socket.on('player-ready', () => {
      const room = this.rooms.get(socket.data.roomCode);
      if (room) room.markReady(socket.id);
    });

    socket.on('player-input', ({ direction, seq } = {}) => {
      const room = this.rooms.get(socket.data.roomCode);
      if (room) room.processInput(socket.id, direction, seq);
    });

    socket.on('use-powerup', ({ powerupType } = {}) => {
      const room = this.rooms.get(socket.data.roomCode);
      if (room) room.processPowerupUse(socket.id, powerupType);
    });

    socket.on('rematch', () => {
      const room = this.rooms.get(socket.data.roomCode);
      if (room) room.voteRematch(socket.id);
    });

    socket.on('leave-room', () => {
      this._leaveRoom(socket);
    });

    socket.on('disconnect', () => {
      if (this._matchmaking) this._matchmaking.remove(socket.id);
      this._leaveRoom(socket);
      console.log(`Socket disconnected: ${socket.id}`);
    });
  }

  _leaveRoom(socket) {
    const code = socket.data.roomCode;
    if (!code) return;

    const room = this.rooms.get(code);
    if (room) {
      room.removePlayer(socket.id);
      if (room.isEmpty) {
        if (room.state !== 'waiting') {
          // Game was in progress or finished — clean up immediately
          room.destroy();
          this.rooms.delete(code);
          console.log(`Room ${code} deleted`);
        } else {
          // Waiting room: keep alive for a grace period so the host can reconnect.
          // The _cleanup() interval will remove it after 5 min of inactivity.
          console.log(`Room ${code} now empty (waiting — kept for reconnection)`);
        }
      }
    }

    socket.data.roomCode = null;
    socket.leave(code);
  }
}

module.exports = { Room, RoomManager, setStats };
