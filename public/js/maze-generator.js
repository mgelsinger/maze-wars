/**
 * MAZE GENERATOR
 * Recursive backtracking (iterative) with extra openings for loops.
 * Uses seeded PRNG (mulberry32) for reproducible mazes.
 */

// Mulberry32 seeded PRNG — same seed = same maze
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getMazeSizeForLevel(level) {
  if (level <= 3)  return { width: 15, height: 15 };
  if (level <= 6)  return { width: 21, height: 21 };
  if (level <= 9)  return { width: 31, height: 31 };
  return { width: 41, height: 41 };
}

export function getExtraOpeningsForLevel(level) {
  if (level <= 3)  return 2;
  if (level <= 6)  return 3;
  if (level <= 9)  return 4;
  return 5;
}

export class MazeGenerator {
  constructor(width, height, seed = Date.now()) {
    this.width  = width;
    this.height = height;
    this.seed   = seed;
    this.rng    = mulberry32(seed);
    this.cells  = null;
  }

  _rand()        { return this.rng(); }
  _randInt(max)  { return Math.floor(this._rand() * max); }
  _idx(x, y)    { return y * this.width + x; }

  _initCells() {
    this.cells = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.cells.push({
          x, y,
          walls:   { n: true, s: true, e: true, w: true },
          visited: false,
        });
      }
    }
  }

  _shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this._randInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  _neighbors(x, y) {
    const result = [];
    if (y > 0)               result.push({ x, y: y - 1, dir: 'n', opp: 's' });
    if (y < this.height - 1) result.push({ x, y: y + 1, dir: 's', opp: 'n' });
    if (x < this.width  - 1) result.push({ x: x + 1, y, dir: 'e', opp: 'w' });
    if (x > 0)               result.push({ x: x - 1, y, dir: 'w', opp: 'e' });
    return result;
  }

  // Iterative recursive-backtracker (avoids call stack overflow on large mazes)
  _carve(startX, startY) {
    const stack = [{ x: startX, y: startY }];
    this.cells[this._idx(startX, startY)].visited = true;

    while (stack.length > 0) {
      const { x, y } = stack[stack.length - 1];
      const cell = this.cells[this._idx(x, y)];

      const unvisited = this._neighbors(x, y).filter(
        n => !this.cells[this._idx(n.x, n.y)].visited
      );

      if (unvisited.length > 0) {
        const chosen = unvisited[this._randInt(unvisited.length)];
        const neighbor = this.cells[this._idx(chosen.x, chosen.y)];

        cell.walls[chosen.dir]     = false;
        neighbor.walls[chosen.opp] = false;
        neighbor.visited = true;

        stack.push({ x: chosen.x, y: chosen.y });
      } else {
        stack.pop();
      }
    }
  }

  // Remove random walls to create loops (multiple paths)
  _addExtraOpenings(count) {
    let attempts = 0;
    let added = 0;
    const maxAttempts = count * 20;

    while (added < count && attempts < maxAttempts) {
      attempts++;
      const x = 1 + this._randInt(this.width  - 2);
      const y = 1 + this._randInt(this.height - 2);
      const dirs = this._shuffle([
        { dir: 'e', opp: 'w', nx: x + 1, ny: y },
        { dir: 's', opp: 'n', nx: x,     ny: y + 1 },
      ]);

      for (const { dir, opp, nx, ny } of dirs) {
        if (nx >= this.width || ny >= this.height) continue;
        if (this.cells[this._idx(x, y)].walls[dir]) {
          this.cells[this._idx(x,  y )].walls[dir] = false;
          this.cells[this._idx(nx, ny)].walls[opp] = false;
          added++;
          break;
        }
      }
    }
  }

  _placeStartExit() {
    const qW = Math.floor(this.width  / 4);
    const qH = Math.floor(this.height / 4);

    const sOx = 1 + this._randInt(Math.max(1, qW - 1));
    const sOy = 1 + this._randInt(Math.max(1, qH - 1));
    const start = { x: sOx, y: sOy };

    const eOx = 1 + this._randInt(Math.max(1, qW - 1));
    const eOy = 1 + this._randInt(Math.max(1, qH - 1));
    const exit = {
      x: this.width  - 1 - eOx,
      y: this.height - 1 - eOy,
    };

    return { start, exit };
  }

  // BFS to confirm path exists — returns path length or -1
  _bfsPath(start, end) {
    const visited = new Set();
    const queue   = [{ x: start.x, y: start.y, dist: 0 }];
    visited.add(`${start.x},${start.y}`);

    while (queue.length > 0) {
      const { x, y, dist } = queue.shift();
      if (x === end.x && y === end.y) return dist;

      const cell = this.cells[this._idx(x, y)];
      const moves = [
        { dir: 'n', nx: x,     ny: y - 1 },
        { dir: 's', nx: x,     ny: y + 1 },
        { dir: 'e', nx: x + 1, ny: y     },
        { dir: 'w', nx: x - 1, ny: y     },
      ];

      for (const { dir, nx, ny } of moves) {
        if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
        if (cell.walls[dir]) continue;
        const key = `${nx},${ny}`;
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({ x: nx, y: ny, dist: dist + 1 });
        }
      }
    }
    return -1;
  }

  _spawnPowerups(start, exit) {
    const powerups = [];
    let   id       = 0;

    const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

    // All cells that are far enough from start and exit
    const candidates = this.cells.filter(c =>
      dist(c, start) >= 3 && dist(c, exit) >= 3
    );

    const tryPlace = (type) => {
      const shuffled = this._shuffle(candidates);
      for (const c of shuffled) {
        if (powerups.some(p => dist(c, p) < 5)) continue;
        powerups.push({ id: `p${++id}`, type, x: c.x, y: c.y, collected: false });
        return true;
      }
      return false;
    };

    // Counts by maze size
    let speedCount, freezeCount;
    if      (this.width <= 15) { speedCount = 2; freezeCount = 1; }
    else if (this.width <= 21) { speedCount = 3; freezeCount = 1; }
    else if (this.width <= 31) { speedCount = 4; freezeCount = 2; }
    else                       { speedCount = 5; freezeCount = 2; }

    for (let i = 0; i < speedCount;  i++) tryPlace('speed_boost');
    for (let i = 0; i < freezeCount; i++) tryPlace('freeze');

    return powerups;
  }

  generate(extraOpenings = 3) {
    this._initCells();

    // Start carving from a cell in the top-left area
    const startCellX = this._randInt(Math.ceil(this.width  / 4));
    const startCellY = this._randInt(Math.ceil(this.height / 4));
    this._carve(startCellX, startCellY);

    this._addExtraOpenings(extraOpenings);

    let { start, exit } = this._placeStartExit();

    // Validate path — if somehow broken, try a few times
    let attempts = 0;
    while (this._bfsPath(start, exit) < 0 && attempts < 5) {
      const r = this._placeStartExit();
      start = r.start;
      exit  = r.exit;
      attempts++;
    }

    const optimalPathLength = this._bfsPath(start, exit);

    return {
      width:  this.width,
      height: this.height,
      seed:   this.seed,
      cells:  this.cells.map(c => ({
        x:     c.x,
        y:     c.y,
        walls: { n: c.walls.n, s: c.walls.s, e: c.walls.e, w: c.walls.w },
      })),
      start,
      exit,
      optimalPathLength,
      powerups: this._spawnPowerups(start, exit),
    };
  }
}
