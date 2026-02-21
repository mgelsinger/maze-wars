/**
 * RENDERER
 * Canvas rendering engine — neon/cyberpunk aesthetic.
 * Wall rendering is cached to an offscreen canvas since walls don't change.
 */

const COLORS = {
  bg:           '#0a0a0f',
  path:         '#0d0d1a',
  wallCore:     '#4a4a7a',
  wallGlow:     '#6c63ff',
  player:       '#00fff5',
  playerGlow:   '#00fff5',
  exit:         '#39ff14',
  exitGlow:     '#39ff14',
  start:        '#00fff5',
  visited:      'rgba(0,255,245,0.04)',
  gridLine:     'rgba(106,99,255,0.06)',
  miniWall:     '#4a4a7a',
  miniPlayer:   '#00fff5',
  miniExit:     '#39ff14',
  puSpeed:      '#00ccff',
  puFreeze:     '#aaddff',
};

export class Renderer {
  constructor(canvas, minimapCanvas) {
    this.canvas   = canvas;
    this.ctx      = canvas.getContext('2d');
    this.minimap  = minimapCanvas;
    this.miniCtx  = minimapCanvas ? minimapCanvas.getContext('2d') : null;

    this._wallCache    = null;  // offscreen canvas for walls
    this._maze         = null;
    this._cellSize     = 20;
    this._dpr          = window.devicePixelRatio || 1;

    // Camera / zoom for intro animation
    this._camX    = 0;
    this._camY    = 0;
    this._zoom    = 1;
    this._zoomTarget  = 1;
    this._introPhase  = 'idle'; // 'zoomout' | 'zoomin' | 'idle'
    this._introTimer  = 0;
    this._introDuration = 1000;
  }

  resize() {
    const dpr = this._dpr;
    const w   = this.canvas.clientWidth;
    const h   = this.canvas.clientHeight;
    this.canvas.width  = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.scale(dpr, dpr);
    this._W = w;
    this._H = h;

    if (this._maze) this._computeLayout();
  }

  setMaze(maze) {
    this._maze    = maze;
    this._wallCache = null; // invalidate cache
    this._computeLayout();
  }

  _computeLayout() {
    const m  = this._maze;
    const W  = this._W || this.canvas.clientWidth  || 600;
    const H  = this._H || this.canvas.clientHeight || 600;

    // Cell size: fit the maze to canvas with some padding, min 12px max 48px
    const maxCellW = Math.floor((W - 20) / m.width);
    const maxCellH = Math.floor((H - 20) / m.height);
    this._cellSize = Math.min(48, Math.max(12, Math.min(maxCellW, maxCellH)));

    this._mazeW = m.width  * this._cellSize;
    this._mazeH = m.height * this._cellSize;

    this._buildWallCache();
  }

  _buildWallCache() {
    const m    = this._maze;
    const cs   = this._cellSize;
    const mw   = this._mazeW;
    const mh   = this._mazeH;

    const oc  = document.createElement('canvas');
    oc.width  = mw;
    oc.height = mh;
    const ctx = oc.getContext('2d');

    // Floor
    ctx.fillStyle = COLORS.path;
    ctx.fillRect(0, 0, mw, mh);

    // Subtle grid
    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth   = 0.5;
    for (let x = 0; x <= m.width; x++) {
      ctx.beginPath(); ctx.moveTo(x * cs, 0); ctx.lineTo(x * cs, mh); ctx.stroke();
    }
    for (let y = 0; y <= m.height; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * cs); ctx.lineTo(mw, y * cs); ctx.stroke();
    }

    // Walls with glow
    const wallWidth = Math.max(1.5, cs * 0.1);

    for (const cell of m.cells) {
      const px = cell.x * cs;
      const py = cell.y * cs;

      // Draw each wall segment (only draw borders — shared walls once)
      const wallSegs = [];
      if (cell.walls.n) wallSegs.push([px,      py,      px + cs, py     ]);
      if (cell.walls.s) wallSegs.push([px,      py + cs, px + cs, py + cs]);
      if (cell.walls.w) wallSegs.push([px,      py,      px,      py + cs]);
      if (cell.walls.e) wallSegs.push([px + cs, py,      px + cs, py + cs]);

      for (const [x1, y1, x2, y2] of wallSegs) {
        // Glow pass
        ctx.save();
        ctx.shadowBlur  = 6;
        ctx.shadowColor = COLORS.wallGlow;
        ctx.strokeStyle = COLORS.wallGlow;
        ctx.lineWidth   = wallWidth;
        ctx.lineCap     = 'square';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();

        // Core bright pass
        ctx.strokeStyle = COLORS.wallCore;
        ctx.lineWidth   = Math.max(1, wallWidth * 0.5);
        ctx.lineCap     = 'square';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

    // Start marker — subtle ring
    this._drawStartMarker(ctx, m.start, cs);

    this._wallCache = oc;
  }

  _drawStartMarker(ctx, start, cs) {
    const cx = start.x * cs + cs / 2;
    const cy = start.y * cs + cs / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(0,255,245,0.3)';
    ctx.lineWidth   = 1.5;
    ctx.shadowBlur  = 8;
    ctx.shadowColor = COLORS.start;
    ctx.beginPath();
    ctx.arc(cx, cy, cs * 0.35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Main render — call every frame
  render(gameState, particles, timestamp) {
    if (!this._maze || !this._wallCache) return;

    const ctx = this.ctx;
    const W   = this._W;
    const H   = this._H;
    const cs  = this._cellSize;
    const m   = this._maze;

    const player = gameState.player;

    // Camera: keep player centered, clamped to maze bounds
    const playerPxX = player.renderX * cs + cs / 2;
    const playerPxY = player.renderY * cs + cs / 2;

    let camX = W / 2 - playerPxX;
    let camY = H / 2 - playerPxY;

    // Clamp so we don't see outside maze
    camX = Math.min(0, Math.max(W - this._mazeW, camX));
    camY = Math.min(0, Math.max(H - this._mazeH, camY));

    // If maze fits, center it
    if (this._mazeW < W) camX = (W - this._mazeW) / 2;
    if (this._mazeH < H) camY = (H - this._mazeH) / 2;

    // Intro zoom
    let zoom   = 1;
    let zoomOX = W / 2;
    let zoomOY = H / 2;
    if (gameState.introZoom !== undefined) {
      zoom = gameState.introZoom;
    }

    // --- Clear ---
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    // --- Hex grid background (decorative, very faint) ---
    this._drawHexGrid(ctx, W, H, timestamp);

    // --- Apply camera transform ---
    ctx.save();
    if (zoom !== 1) {
      ctx.translate(zoomOX, zoomOY);
      ctx.scale(zoom, zoom);
      ctx.translate(-zoomOX, -zoomOY);
    }
    ctx.translate(camX, camY);

    // --- Wall cache (static) ---
    ctx.drawImage(this._wallCache, 0, 0);

    // --- Visited cell trails ---
    if (gameState.visitedCells) {
      ctx.fillStyle = COLORS.visited;
      for (const key of gameState.visitedCells) {
        const [vx, vy] = key.split(',').map(Number);
        ctx.fillRect(vx * cs + 1, vy * cs + 1, cs - 2, cs - 2);
      }
    }

    // --- Particles (behind players) ---
    particles.draw(ctx);

    // --- Powerups ---
    if (gameState.powerups) {
      this._drawPowerups(ctx, gameState.powerups, cs, timestamp);
    }

    // --- Exit portal ---
    this._drawExit(ctx, m.exit, cs, timestamp);

    // --- Opponent ghost (behind local player so player is always on top) ---
    if (gameState.opponent && gameState.opponent.connected) {
      this._drawOpponent(ctx, gameState.opponent, cs, timestamp);
    }

    // --- Player ---
    this._drawPlayer(ctx, player, cs, timestamp);

    ctx.restore();

    // --- Minimap ---
    if (this.miniCtx) {
      this._drawMinimap(gameState, timestamp);
    }
  }

  _drawHexGrid(ctx, W, H, ts) {
    // Subtle animated hex-grid overlay (very faint)
    ctx.save();
    ctx.strokeStyle = 'rgba(106,99,255,0.04)';
    ctx.lineWidth   = 0.5;
    const size  = 28;
    const h     = size * Math.sqrt(3);
    const offX  = ((ts * 0.01) % (size * 3)) - size * 3;
    const offY  = ((ts * 0.006) % h) - h;
    for (let gy = offY; gy < H + h; gy += h) {
      for (let gx = offX; gx < W + size * 3; gx += size * 3) {
        this._hexPath(ctx, gx,            gy,          size);
        this._hexPath(ctx, gx + size * 1.5, gy + h / 2, size);
      }
    }
    ctx.restore();
  }

  _hexPath(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  _drawExit(ctx, exit, cs, ts) {
    const cx = exit.x * cs + cs / 2;
    const cy = exit.y * cs + cs / 2;
    const r  = cs * 0.38;
    const pulse = 0.7 + 0.3 * Math.sin(ts / 400);

    // Outer glow rings
    for (let i = 3; i >= 1; i--) {
      ctx.save();
      ctx.globalAlpha = 0.06 * pulse * i;
      ctx.fillStyle   = COLORS.exit;
      ctx.shadowBlur  = 0;
      ctx.beginPath();
      ctx.arc(cx, cy, r + i * 4 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Portal body
    ctx.save();
    ctx.shadowBlur  = 20 * pulse;
    ctx.shadowColor = COLORS.exitGlow;
    ctx.fillStyle   = COLORS.exit;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Inner bright core
    ctx.save();
    ctx.fillStyle  = '#ffffff';
    ctx.globalAlpha = 0.5 * pulse;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Spark particles emanating from exit (random, fast)
    if (Math.random() < 0.3) {
      const a = Math.random() * Math.PI * 2;
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = COLORS.exit;
      ctx.shadowColor = COLORS.exit;
      ctx.shadowBlur  = 4;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 1.1, cy + Math.sin(a) * r * 1.1);
      ctx.lineTo(cx + Math.cos(a) * (r + 3 + Math.random() * 6), cy + Math.sin(a) * (r + 3 + Math.random() * 6));
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawPlayer(ctx, player, cs, ts) {
    const px = player.renderX * cs + cs / 2;
    const py = player.renderY * cs + cs / 2;
    const r  = cs * 0.25;

    const isMoving = player.isMoving;
    const pulse    = isMoving ? 1 : (0.85 + 0.15 * Math.sin(ts / 300));

    // Outer aura
    const gradient = ctx.createRadialGradient(px, py, 0, px, py, r * 3);
    gradient.addColorStop(0, 'rgba(0,255,245,0.15)');
    gradient.addColorStop(1, 'rgba(0,255,245,0)');
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(px, py, r * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Player circle
    ctx.save();
    ctx.shadowBlur  = 18 * pulse;
    ctx.shadowColor = COLORS.playerGlow;
    ctx.fillStyle   = COLORS.player;
    ctx.beginPath();
    ctx.arc(px, py, r * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Inner bright core
    ctx.save();
    ctx.fillStyle   = '#ffffff';
    ctx.globalAlpha = 0.7 * pulse;
    ctx.beginPath();
    ctx.arc(px, py, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Opponent ghost — translucent magenta, flickering
  _drawOpponent(ctx, opponent, cs, ts) {
    const px = opponent.renderX * cs + cs / 2;
    const py = opponent.renderY * cs + cs / 2;
    const r  = cs * 0.22;

    const flicker = 0.7 + 0.3 * Math.sin(ts / 180 + 2.3);

    // Outer aura
    ctx.save();
    ctx.globalAlpha = 0.15 * flicker;
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = '#ff00aa';
    ctx.beginPath();
    ctx.arc(px, py, r * 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Ghost body
    ctx.save();
    ctx.globalAlpha = 0.5 * flicker;
    ctx.shadowBlur  = 14 * flicker;
    ctx.shadowColor = '#ff00aa';
    ctx.fillStyle   = '#ff00aa';
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Inner core (bright)
    ctx.save();
    ctx.globalAlpha = 0.6 * flicker;
    ctx.fillStyle   = '#ffaadd';
    ctx.beginPath();
    ctx.arc(px, py, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawPowerups(ctx, powerups, cs, ts) {
    for (const p of powerups) {
      if (p.collected) continue;
      const cx = p.x * cs + cs / 2;
      const cy = p.y * cs + cs / 2;
      const pulse = 0.8 + 0.2 * Math.sin(ts / 350 + p.x * 0.7 + p.y * 0.5);
      if (p.type === 'speed_boost') {
        this._drawSpeedPowerup(ctx, cx, cy, cs, pulse, ts);
      } else if (p.type === 'freeze') {
        this._drawFreezePowerup(ctx, cx, cy, cs, pulse, ts);
      }
    }
  }

  _drawSpeedPowerup(ctx, cx, cy, cs, pulse, ts) {
    const r = cs * 0.28 * pulse;

    // Outer glow
    ctx.save();
    ctx.shadowBlur  = 16 * pulse;
    ctx.shadowColor = COLORS.puSpeed;
    ctx.fillStyle   = COLORS.puSpeed;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // White core
    ctx.save();
    ctx.fillStyle   = '#ffffff';
    ctx.globalAlpha = 0.6 * pulse;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Lightning bolt (⚡ shape)
    const h = r * 0.75;
    const w = r * 0.42;
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = Math.max(1, cs * 0.06);
    ctx.lineJoin    = 'round';
    ctx.globalAlpha = 0.9 * pulse;
    ctx.shadowBlur  = 4;
    ctx.shadowColor = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx + w * 0.4, cy - h);
    ctx.lineTo(cx - w * 0.5, cy - h * 0.05);
    ctx.lineTo(cx + w * 0.3, cy - h * 0.05);
    ctx.lineTo(cx - w * 0.4, cy + h);
    ctx.stroke();
    ctx.restore();
  }

  _drawFreezePowerup(ctx, cx, cy, cs, pulse, ts) {
    const r   = cs * 0.26 * pulse;
    const rot = ts / 1800; // slow rotation

    // Outer glow
    ctx.save();
    ctx.shadowBlur  = 14 * pulse;
    ctx.shadowColor = COLORS.puFreeze;
    ctx.fillStyle   = COLORS.puFreeze;
    ctx.globalAlpha = 0.80;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // White core
    ctx.save();
    ctx.fillStyle   = '#ffffff';
    ctx.globalAlpha = 0.55 * pulse;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Snowflake arms (4 axes = 8 spokes)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = Math.max(1, cs * 0.05);
    ctx.shadowBlur  = 5;
    ctx.shadowColor = COLORS.puFreeze;
    ctx.globalAlpha = 0.9 * pulse;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.85, 0);
      ctx.lineTo( r * 0.85, 0);
      ctx.stroke();
      ctx.rotate(Math.PI / 4);
    }
    ctx.restore();
  }

  _drawMinimap(gameState, ts) {
    const m   = this._maze;
    const mmc = this.miniCtx;
    const mmW = this.minimap.width;
    const mmH = this.minimap.height;

    const cs = Math.max(2, Math.floor(Math.min(mmW / m.width, mmH / m.height)));
    const mw = m.width  * cs;
    const mh = m.height * cs;
    const ox = Math.floor((mmW - mw) / 2);
    const oy = Math.floor((mmH - mh) / 2);

    // Background
    mmc.fillStyle = '#0a0a0f';
    mmc.fillRect(0, 0, mmW, mmH);

    // Cells
    for (const cell of m.cells) {
      const px = ox + cell.x * cs;
      const py = oy + cell.y * cs;

      // Floor
      mmc.fillStyle = '#12121a';
      mmc.fillRect(px, py, cs, cs);

      // Walls (draw border lines)
      mmc.strokeStyle = COLORS.miniWall;
      mmc.lineWidth   = 0.5;

      if (cell.walls.n) { mmc.beginPath(); mmc.moveTo(px, py);      mmc.lineTo(px + cs, py);      mmc.stroke(); }
      if (cell.walls.s) { mmc.beginPath(); mmc.moveTo(px, py + cs); mmc.lineTo(px + cs, py + cs); mmc.stroke(); }
      if (cell.walls.w) { mmc.beginPath(); mmc.moveTo(px, py);      mmc.lineTo(px, py + cs);      mmc.stroke(); }
      if (cell.walls.e) { mmc.beginPath(); mmc.moveTo(px + cs, py); mmc.lineTo(px + cs, py + cs); mmc.stroke(); }
    }

    // Visited trail
    if (gameState.visitedCells) {
      mmc.fillStyle = 'rgba(0,255,245,0.25)';
      for (const key of gameState.visitedCells) {
        const [vx, vy] = key.split(',').map(Number);
        mmc.fillRect(ox + vx * cs, oy + vy * cs, cs, cs);
      }
    }

    // Exit
    const ex = ox + m.exit.x * cs + cs / 2;
    const ey = oy + m.exit.y * cs + cs / 2;
    mmc.fillStyle  = COLORS.miniExit;
    mmc.shadowBlur = 4;
    mmc.shadowColor = COLORS.miniExit;
    mmc.beginPath();
    mmc.arc(ex, ey, Math.max(1, cs / 2), 0, Math.PI * 2);
    mmc.fill();
    mmc.shadowBlur = 0;

    // Player dot
    const ppx = ox + gameState.player.renderX * cs + cs / 2;
    const ppy = oy + gameState.player.renderY * cs + cs / 2;
    const pulse = 0.8 + 0.2 * Math.sin(ts / 300);
    mmc.fillStyle   = COLORS.miniPlayer;
    mmc.shadowBlur  = 4;
    mmc.shadowColor = COLORS.miniPlayer;
    mmc.beginPath();
    mmc.arc(ppx, ppy, Math.max(1, cs / 2 + 1) * pulse, 0, Math.PI * 2);
    mmc.fill();
    mmc.shadowBlur = 0;
  }

  // Render an animated maze on the menu background canvas
  renderMenuBackground(canvas, mazeData, ts) {
    if (!canvas || !mazeData) return;

    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;

    const cs = Math.min(
      Math.floor(W / mazeData.width),
      Math.floor(H / mazeData.height)
    );
    if (cs < 2) return;

    const mw = mazeData.width  * cs;
    const mh = mazeData.height * cs;
    const ox = Math.floor((W - mw) / 2);
    const oy = Math.floor((H - mh) / 2);

    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, W, H);

    // Walls
    ctx.strokeStyle = 'rgba(108,99,255,0.5)';
    ctx.lineWidth   = 1;

    for (const cell of mazeData.cells) {
      const px = ox + cell.x * cs;
      const py = oy + cell.y * cs;
      if (cell.walls.n) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + cs, py); ctx.stroke(); }
      if (cell.walls.w) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + cs); ctx.stroke(); }
    }
    // Right and bottom border
    ctx.beginPath();
    ctx.rect(ox, oy, mw, mh);
    ctx.stroke();
  }
}
