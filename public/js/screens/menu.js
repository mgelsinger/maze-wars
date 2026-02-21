/**
 * MENU SCREEN
 * Main menu with animated background maze.
 */

import { MazeGenerator } from '../maze-generator.js';
import { Renderer }      from '../renderer.js';

export class MenuScreen {
  constructor(app) {
    this._app       = app;
    this._el        = document.getElementById('screen-menu');
    this._bgCanvas  = document.getElementById('menu-bg-canvas');
    this._animId    = null;
    this._bgMaze    = null;
    this._renderer  = new Renderer(document.createElement('canvas'), null);

    // Animated explorer state
    this._explorer  = null;
    this._explorerPath = [];
    this._explorerStep = 0;
    this._explorerTimer = 0;
    this._lastTs    = 0;

    this._bindEvents();
  }

  _bindEvents() {
    document.getElementById('btn-play')
      .addEventListener('click', () => this._app.navigate('lobby'));

    document.getElementById('btn-leaderboard')
      .addEventListener('click', () => this._app.navigate('leaderboard'));

    document.getElementById('btn-profile')
      .addEventListener('click', () => this._app.navigate('profile'));

    document.getElementById('btn-ai-api')
      ?.addEventListener('click', () => this._app.navigate('apidocs'));

    document.getElementById('btn-change-name')
      .addEventListener('click', () => this._app.promptUsername());
  }

  _flashComing(msg) {
    const existing = document.querySelector('.flash-msg');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = 'flash-msg';
    el.textContent = msg;
    el.style.cssText = `
      position:fixed; bottom:40px; left:50%; transform:translateX(-50%);
      font-family:var(--font-hud); font-size:12px; letter-spacing:.2em;
      color:var(--text-secondary); background:var(--bg-panel);
      border:1px solid var(--bg-panel-border); padding:8px 20px;
      animation:fadeOut 2.5s ease forwards; pointer-events:none; z-index:999;
    `;
    document.head.insertAdjacentHTML('beforeend', `<style>@keyframes fadeOut{0%{opacity:1}70%{opacity:1}100%{opacity:0}}</style>`);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  show() {
    this._el.classList.add('active');
    this._updateUsername();
    this._generateBgMaze();
    this._startAnimation();
  }

  hide() {
    this._el.classList.remove('active');
    this._stopAnimation();
  }

  _updateUsername() {
    const el = document.getElementById('menu-username');
    if (el) el.textContent = this._app.getUsername();
  }

  _generateBgMaze() {
    const gen = new MazeGenerator(21, 21, Math.floor(Math.random() * 999999));
    this._bgMaze = gen.generate(3);
    this._computeExplorerPath();
  }

  _computeExplorerPath() {
    const m = this._bgMaze;
    if (!m) return;

    // BFS from start → exit to find a path
    const start  = m.start;
    const exit   = m.exit;
    const width  = m.width;
    const cells  = m.cells;

    const idx  = (x, y) => y * width + x;
    const seen = new Map();
    const queue = [{ x: start.x, y: start.y }];
    seen.set(`${start.x},${start.y}`, null);

    const dirs = [
      { dir: 'n', dx: 0, dy: -1 }, { dir: 's', dx: 0, dy: 1 },
      { dir: 'e', dx: 1, dy: 0  }, { dir: 'w', dx: -1, dy: 0 },
    ];

    while (queue.length > 0) {
      const { x, y } = queue.shift();
      if (x === exit.x && y === exit.y) break;
      const cell = cells[idx(x, y)];
      for (const { dir, dx, dy } of dirs) {
        if (cell.walls[dir]) continue;
        const nx = x + dx; const ny = y + dy;
        const key = `${nx},${ny}`;
        if (!seen.has(key)) {
          seen.set(key, `${x},${y}`);
          queue.push({ x: nx, y: ny });
        }
      }
    }

    // Reconstruct path
    const path = [];
    let cur = `${exit.x},${exit.y}`;
    while (cur !== null) {
      const [px, py] = cur.split(',').map(Number);
      path.unshift({ x: px, y: py });
      cur = seen.get(cur) ?? null;
    }

    this._explorerPath  = path;
    this._explorerStep  = 0;
    this._explorerTimer = 0;
    this._explorer = path[0] ? { ...path[0] } : { x: start.x, y: start.y };
  }

  _startAnimation() {
    this._resizeBgCanvas();
    this._lastTs = performance.now();
    const loop = (ts) => {
      this._animId = requestAnimationFrame(loop);
      const dt = ts - this._lastTs;
      this._lastTs = ts;
      this._tickExplorer(dt);
      this._renderBg(ts);
    };
    this._animId = requestAnimationFrame(loop);
  }

  _stopAnimation() {
    if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
  }

  _resizeBgCanvas() {
    const c = this._bgCanvas;
    c.width  = window.innerWidth;
    c.height = window.innerHeight;
  }

  _tickExplorer(dt) {
    const STEP_MS = 250;
    this._explorerTimer += dt;
    while (this._explorerTimer >= STEP_MS) {
      this._explorerTimer -= STEP_MS;
      this._explorerStep = (this._explorerStep + 1) % this._explorerPath.length;
      this._explorer = { ...this._explorerPath[this._explorerStep] };
      // Reset maze occasionally
      if (this._explorerStep === this._explorerPath.length - 1) {
        setTimeout(() => this._generateBgMaze(), 600);
      }
    }
  }

  _renderBg(ts) {
    const m = this._bgMaze;
    if (!m) return;

    const c   = this._bgCanvas;
    const ctx = c.getContext('2d');
    const W   = c.width;
    const H   = c.height;

    const cs  = Math.floor(Math.min(W / m.width, H / m.height));
    const mw  = m.width  * cs;
    const mh  = m.height * cs;
    const ox  = Math.floor((W - mw) / 2);
    const oy  = Math.floor((H - mh) / 2);

    ctx.clearRect(0, 0, W, H);

    // Walls
    ctx.strokeStyle = 'rgba(108,99,255,0.6)';
    ctx.lineWidth   = 1;
    ctx.shadowBlur  = 4;
    ctx.shadowColor = 'rgba(108,99,255,0.5)';

    for (const cell of m.cells) {
      const px = ox + cell.x * cs;
      const py = oy + cell.y * cs;
      if (cell.walls.n) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + cs, py); ctx.stroke(); }
      if (cell.walls.w) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + cs); ctx.stroke(); }
    }
    // Border
    ctx.beginPath(); ctx.rect(ox, oy, mw, mh); ctx.stroke();
    ctx.shadowBlur = 0;

    // Explorer dot
    if (this._explorer) {
      const ex = ox + this._explorer.x * cs + cs / 2;
      const ey = oy + this._explorer.y * cs + cs / 2;
      const r  = Math.max(2, cs * 0.25);
      const pulse = 0.8 + 0.2 * Math.sin(ts / 400);
      ctx.save();
      ctx.shadowBlur  = 10;
      ctx.shadowColor = '#00fff5';
      ctx.fillStyle   = '#00fff5';
      ctx.beginPath();
      ctx.arc(ex, ey, r * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
