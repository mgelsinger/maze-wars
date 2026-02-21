/**
 * AI BOT SYSTEM
 * Built-in bot opponents: GLITCH (easy), CIPHER (medium), NEXUS (hard).
 * Uses FakeSocket (EventEmitter) to plug into the same Room interface as real players.
 * Bots drive themselves via setInterval, calling room.processInput() directly.
 */

'use strict';

const { EventEmitter } = require('events');

// ─── FakeSocket ───────────────────────────────────────────────────────────────
// Minimal EventEmitter-based socket substitute.
// Room calls socket.on/emit to communicate — bots use the same EventEmitter API.
class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.id     = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.data   = { roomCode: null };
    this._isBot = true;
  }
  join()  {}  // no-op — bots don't need Socket.IO room membership
  leave() {}  // no-op
}

// ─── BFS ──────────────────────────────────────────────────────────────────────
function bfs(cells, width, start, goal) {
  const idx   = (x, y) => y * width + x;
  const seen  = new Map([[idx(start.x, start.y), -1]]);
  const queue = [{ x: start.x, y: start.y }];
  const DIRS  = [
    { dir: 'n', dx: 0, dy: -1 }, { dir: 's', dx: 0, dy:  1 },
    { dir: 'e', dx: 1, dy:  0 }, { dir: 'w', dx:-1, dy:  0 },
  ];

  while (queue.length) {
    const { x, y } = queue.shift();
    if (x === goal.x && y === goal.y) {
      const path = [];
      let cur = idx(x, y);
      while (cur !== -1) {
        path.unshift({ x: cur % width, y: Math.floor(cur / width) });
        cur = seen.get(cur) ?? -1;
      }
      return path;
    }
    const cell = cells[idx(x, y)];
    if (!cell) continue;
    for (const { dir, dx, dy } of DIRS) {
      if (cell.walls[dir]) continue;
      const nk = idx(x + dx, y + dy);
      if (!seen.has(nk)) {
        seen.set(nk, idx(x, y));
        queue.push({ x: x + dx, y: y + dy });
      }
    }
  }
  return null;
}

// ─── A* ───────────────────────────────────────────────────────────────────────
function aStar(cells, width, start, goal) {
  const idx  = (x, y) => y * width + x;
  const h    = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  const DIRS = [
    { dir: 'n', dx: 0, dy: -1 }, { dir: 's', dx: 0, dy:  1 },
    { dir: 'e', dx: 1, dy:  0 }, { dir: 'w', dx:-1, dy:  0 },
  ];

  const gScore = new Map();
  const parent = new Map();
  const closed = new Set();
  const open   = [];

  const sk = idx(start.x, start.y);
  gScore.set(sk, 0);
  parent.set(sk, -1);
  open.push({ k: sk, f: h(start.x, start.y) });

  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const { k: ck } = open.splice(bi, 1)[0];

    if (closed.has(ck)) continue;
    closed.add(ck);

    const cx = ck % width, cy = Math.floor(ck / width);
    if (cx === goal.x && cy === goal.y) {
      const path = [];
      let cur = ck;
      while (cur !== -1) {
        path.unshift({ x: cur % width, y: Math.floor(cur / width) });
        cur = parent.get(cur) ?? -1;
      }
      return path;
    }

    const cell = cells[ck];
    if (!cell) continue;

    for (const { dir, dx, dy } of DIRS) {
      if (cell.walls[dir]) continue;
      const nx = cx + dx, ny = cy + dy;
      const nk = idx(nx, ny);
      if (closed.has(nk)) continue;
      const tg = gScore.get(ck) + 1;
      if (tg < (gScore.get(nk) ?? Infinity)) {
        parent.set(nk, ck);
        gScore.set(nk, tg);
        open.push({ k: nk, f: tg + h(nx, ny) });
      }
    }
  }
  return null;
}

// ─── AiBot ────────────────────────────────────────────────────────────────────
const BOT_NAMES  = { easy: 'GLITCH', medium: 'CIPHER', hard: 'NEXUS' };
const MOVE_SPEED = { easy: 200,      medium: 150,       hard: 120    };

class AiBot {
  constructor(difficulty = 'medium') {
    this.difficulty = difficulty;
    this.name       = BOT_NAMES[difficulty] || 'BOT';
    this.socket     = new FakeSocket();
    this._room      = null;
    this._path      = [];
    this._stepCount = 0;
    this._recalcAt  = this._nextRecalc();
    this._interval  = null;

    // Room sends 'game-start' directly to player.socket
    this.socket.on('game-start', () => this._onGameStart());
  }

  setRoom(room) { this._room = room; }

  // ── Private ──────────────────────────────────────────────────────────────

  _nextRecalc() {
    if (this.difficulty === 'easy')   return 8 + Math.floor(Math.random() * 5);
    if (this.difficulty === 'medium') return 3 + Math.floor(Math.random() * 3);
    return 1;
  }

  _onGameStart() {
    this._path      = [];
    this._stepCount = 0;
    this._recalcAt  = this._nextRecalc();
    if (this._interval) clearInterval(this._interval);
    this._interval = setInterval(() => this._tick(), MOVE_SPEED[this.difficulty] || 150);
  }

  _tick() {
    const room = this._room;
    if (!room) return;

    // Auto-stop when game ends
    if (room.state === 'finished' || room.state === 'waiting') {
      clearInterval(this._interval);
      this._interval = null;
      return;
    }
    if (room.state !== 'playing') return;

    const me = room.players.find(p => p.id === this.socket.id);
    if (!me) return;

    const maze = room.maze;
    if (!maze) return;

    if (me.effects.freeze > 0) return; // frozen — wait

    this._maybeUsePowerup(room, me);

    if (this._path.length === 0 || this._stepCount >= this._recalcAt) {
      this._recalcPath(room, me, maze);
    }

    if (this._path.length === 0) return;

    // Random wrong turn (easy/medium)
    const wrongChance = this.difficulty === 'easy' ? 0.20 : this.difficulty === 'medium' ? 0.05 : 0;
    if (wrongChance > 0 && Math.random() < wrongChance) {
      const dir = this._randValidDir(maze, me.x, me.y);
      if (dir) room.processInput(this.socket.id, dir, Date.now());
      this._path = [];
      this._stepCount = this._recalcAt; // force recalc next tick
      return;
    }

    const next = this._path[0];
    const dir  = this._dirTo(me.x, me.y, next.x, next.y);
    if (!dir) { this._path = []; return; }

    room.processInput(this.socket.id, dir, Date.now());
    this._path.shift();
    this._stepCount++;
  }

  _recalcPath(room, me, maze) {
    this._stepCount = 0;
    this._recalcAt  = this._nextRecalc();

    let target = maze.exit;

    // CIPHER: detour up to 3 cells for powerups
    if (this.difficulty === 'medium') {
      const puTarget = this._nearbyPowerupTarget(room, maze, me);
      if (puTarget) target = puTarget;
    }

    const pathFn = this.difficulty === 'easy' ? bfs : aStar;
    const full   = pathFn(maze.cells, maze.width, { x: me.x, y: me.y }, target);
    this._path   = full ? full.slice(1) : [];
  }

  _maybeUsePowerup(room, me) {
    if (this.difficulty === 'easy') return; // GLITCH never uses powerups

    if (me.powerupsHeld.includes('speed_boost')) {
      room.processPowerupUse(this.socket.id, 'speed_boost');
    }

    if (this.difficulty === 'hard' && me.powerupsHeld.includes('freeze')) {
      // NEXUS: freeze when opponent is within 5 cells of the exit
      const opp = room.players.find(p => p.id !== this.socket.id);
      if (opp && room.maze) {
        const dist = Math.abs(opp.x - room.maze.exit.x) + Math.abs(opp.y - room.maze.exit.y);
        if (dist <= 5) room.processPowerupUse(this.socket.id, 'freeze');
      }
    }
  }

  _nearbyPowerupTarget(room, maze, me) {
    const available = room.powerups.filter(p => !p.collected);
    if (!available.length) return null;

    const direct = aStar(maze.cells, maze.width, { x: me.x, y: me.y }, maze.exit);
    if (!direct) return null;

    for (const pu of available) {
      const topu = aStar(maze.cells, maze.width, { x: me.x, y: me.y }, pu);
      const frpu = aStar(maze.cells, maze.width, pu, maze.exit);
      if (topu && frpu && (topu.length + frpu.length) - direct.length <= 3) {
        return pu;
      }
    }
    return null;
  }

  _dirTo(fx, fy, tx, ty) {
    if (tx === fx + 1) return 'e';
    if (tx === fx - 1) return 'w';
    if (ty === fy + 1) return 's';
    if (ty === fy - 1) return 'n';
    return null;
  }

  _randValidDir(maze, x, y) {
    const DIRS = [
      { dir: 'n', dx: 0, dy: -1 }, { dir: 's', dx: 0, dy:  1 },
      { dir: 'e', dx: 1, dy:  0 }, { dir: 'w', dx:-1, dy:  0 },
    ];
    const cell = maze.cells[y * maze.width + x];
    if (!cell) return null;
    const valid = DIRS.filter(d => !cell.walls[d.dir]);
    return valid.length ? valid[Math.floor(Math.random() * valid.length)].dir : null;
  }
}

module.exports = { AiBot, BOT_NAMES, MOVE_SPEED };
