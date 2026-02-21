/**
 * GAME SCREEN — Phase 3
 * Supports solo and VS modes with full powerup support.
 *
 * Powerup flow:
 *  - Walking onto a powerup cell collects it into _heldPowerups
 *  - Press SPACE/F/E to use the first held powerup
 *  - speed_boost: reduces moveSpeed to 90ms for 5s, spawns stream particles
 *  - freeze (VS only): freezes opponent for 3s; shows freeze overlay on victim
 */

import { MazeGenerator, getMazeSizeForLevel, getExtraOpeningsForLevel } from '../maze-generator.js';
import { Renderer }       from '../renderer.js';
import { ParticleSystem } from '../particles.js';
import { UIManager }      from '../ui.js';
import { input }          from '../input.js';
import { audio }          from '../audio.js';
import { network }        from '../network.js';

const MOVE_DURATION  = 150;   // ms per cell (base speed)
const SPEED_DURATION =  90;   // ms per cell when boosted
const TRAIL_INTERVAL =  80;   // ms between trail particles

// ─── Scoring (solo) ──────────────────────────────────────────────────────────
function calcScore(timeMs, optimalPath, visitedCount, powerupsCollected, freezesUsed) {
  const base        = 1000;
  const timeBonus   = Math.max(0, Math.floor(5000 - timeMs / 100));
  const effBonus    = optimalPath > 0
    ? Math.floor((optimalPath / Math.max(optimalPath, visitedCount)) * 1000)
    : 0;
  const puBonus     = powerupsCollected * 200;
  const freezeBonus = freezesUsed * 300;
  return base + timeBonus + effBonus + puBonus + freezeBonus;
}

function fmtTime(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const c = ms % 1000;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(c).padStart(3,'0')}`;
}

export class GameScreen {
  constructor(app) {
    this._app       = app;
    this._el        = document.getElementById('screen-game');
    this._canvas    = document.getElementById('game-canvas');
    this._minimap   = document.getElementById('minimap-canvas');
    this._renderer  = new Renderer(this._canvas, this._minimap);
    this._particles = new ParticleSystem();
    this._ui        = new UIManager();
    this._animId    = null;
    this._lastTs    = 0;
    this._config    = null;
    this._mode      = 'solo';  // 'solo' | 'vs'
    this._netUnsubs = [];      // network listener cleanup fns

    document.getElementById('btn-quit-game')
      .addEventListener('click', () => this._quit());
    document.getElementById('mhud-quit')
      ?.addEventListener('click', () => this._quit());
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  show(config = {}) {
    this._config = config;
    this._mode   = config.mode === 'vs' ? 'vs' : 'solo';
    this._el.classList.add('active');
    audio.init();

    const oppPanel = document.getElementById('opponent-panel');
    if (oppPanel) oppPanel.style.display = this._mode === 'vs' ? '' : 'none';

    requestAnimationFrame(() => {
      this._renderer.resize();
      if (this._mode === 'vs') {
        this._initVSGame(config);
      } else {
        this._initSoloGame(config);
      }
    });

    window.addEventListener('resize', this._onResize = () => this._renderer.resize());
  }

  hide() {
    this._el.classList.remove('active');
    this._stopLoop();
    input.disable();
    input.flush();
    window.removeEventListener('resize', this._onResize);
    this._particles.clear();
    this._ui.hideCountdown();
    this._ui.showFreezeOverlay(false);
    this._hideOutcome();
    this._teardownNetwork();
  }

  _quit() {
    if (this._mode === 'vs') network.leaveRoom();
    this._app.navigate('menu');
  }

  // ── Shared Init Helpers ───────────────────────────────────────────────────────

  _initCommonState(level) {
    this._gameState        = 'countdown';
    this._startTime        = 0;
    this._elapsedMs        = 0;
    this._visitedCells     = new Set();
    this._trailTimer       = 0;
    this._level            = level;
    this._score            = 0;
    this._streak           = parseInt(localStorage.getItem('mw_streak') || '0');
    this._elo              = parseInt(localStorage.getItem('mw_elo')    || '1000');
    this._seq              = 0;
    // Powerup state
    this._powerups         = [];   // { id, type, x, y, collected }
    this._heldPowerups     = [];   // types held by player
    this._playerEffects    = { speed_boost: 0, freeze: 0 }; // countdown ms
    this._powerupsCollected = 0;
    this._freezesUsed      = 0;

    this._ui.updateLevel(level);
    this._ui.updateScore(0);
    this._ui.updateStreak(this._streak);
    this._ui.updateElo(this._elo);
    this._ui.updateEffects([]);
    this._ui.updateHeldPowerups([]);
    this._ui.updateTimer(0);
  }

  // ── Solo Mode Init ───────────────────────────────────────────────────────────

  _initSoloGame(config) {
    const level = config.level || 1;
    const seed  = config.seed  || Math.floor(Math.random() * 0xFFFFFF);
    const extra = getExtraOpeningsForLevel(level);
    const { width, height } = getMazeSizeForLevel(level);

    const gen  = new MazeGenerator(width, height, seed);
    this._maze = gen.generate(extra);

    this._renderer.setMaze(this._maze);
    this._particles.clear();
    this._opponent = null;

    this._initCommonState(level);
    this._player = this._makePlayer(this._maze.start.x, this._maze.start.y);
    this._visitedCells.add(`${this._maze.start.x},${this._maze.start.y}`);

    // Clone powerups for client-side tracking
    this._powerups = this._maze.powerups.map(p => ({ ...p, collected: false }));

    this._startCountdown();
  }

  // ── VS Mode Init ─────────────────────────────────────────────────────────────

  _initVSGame(config) {
    const {
      seed, level = 1, extraOpenings,
      yourId, yourPosition, opponentPosition, opponentName,
    } = config;

    this._myId = yourId;
    const extra = extraOpenings ?? getExtraOpeningsForLevel(level);
    const { width, height } = getMazeSizeForLevel(level);

    const gen  = new MazeGenerator(width, height, seed);
    this._maze = gen.generate(extra);

    this._renderer.setMaze(this._maze);
    this._particles.clear();

    this._player = this._makePlayer(
      (yourPosition || this._maze.start).x,
      (yourPosition || this._maze.start).y,
    );

    this._opponent = {
      gridX:     (opponentPosition || this._maze.start).x,
      gridY:     (opponentPosition || this._maze.start).y,
      renderX:   (opponentPosition || this._maze.start).x,
      renderY:   (opponentPosition || this._maze.start).y,
      name:      opponentName || 'OPPONENT',
      connected: true,
    };

    this._initCommonState(level);
    this._visitedCells.add(`${this._player.gridX},${this._player.gridY}`);

    // Clone powerups for client-side rendering
    this._powerups = this._maze.powerups.map(p => ({ ...p, collected: false }));

    const nameEl = document.getElementById('opponent-name-hud');
    if (nameEl) nameEl.textContent = this._opponent.name;

    this._setupVSNetwork();
    this._startCountdown();
  }

  _makePlayer(gx, gy) {
    return {
      gridX:         gx,
      gridY:         gy,
      renderX:       gx,
      renderY:       gy,
      isMoving:      false,
      moveFrom:      null,
      moveTo:        null,
      moveStartTime: 0,
      bufferedDir:   null,
      moveSpeed:     MOVE_DURATION,
      effects:       {},
    };
  }

  // ── VS Network ───────────────────────────────────────────────────────────────

  _setupVSNetwork() {
    this._teardownNetwork();

    this._netUnsubs.push(
      // Server broadcasts state every 50ms
      network.on('game-state', ({ players, powerups }) => {
        if (!players || this._gameState === 'finished') return;

        // Update opponent position
        const opp = players.find(p => p.id !== this._myId);
        if (opp && this._opponent) {
          this._opponent.gridX = opp.x;
          this._opponent.gridY = opp.y;
        }

        // Sync powerup collected state from server
        if (powerups) {
          for (const sp of powerups) {
            const local = this._powerups.find(p => p.id === sp.id);
            if (local && sp.collected) local.collected = true;
          }
        }

        // Sync held powerups from server (authoritative)
        const me = players.find(p => p.id === this._myId);
        if (me && me.powerupsHeld) {
          this._heldPowerups = [...me.powerupsHeld];
          this._ui.updateHeldPowerups(this._heldPowerups);
        }
      }),

      // Server confirmed our move
      network.on('move-confirmed', ({ seq, position }) => {
        if (Math.abs(position.x - this._player.gridX) + Math.abs(position.y - this._player.gridY) > 1) {
          this._player.gridX    = position.x;
          this._player.gridY    = position.y;
          this._player.renderX  = position.x;
          this._player.renderY  = position.y;
          this._player.isMoving = false;
        }
      }),

      // Server rejected our move — rubber-band
      network.on('move-rejected', ({ correctPosition }) => {
        this._player.gridX       = correctPosition.x;
        this._player.gridY       = correctPosition.y;
        this._player.renderX     = correctPosition.x;
        this._player.renderY     = correctPosition.y;
        this._player.isMoving    = false;
        this._player.bufferedDir = null;
      }),

      // A powerup was collected (by either player)
      network.on('powerup-collected', ({ playerId, powerupId, type }) => {
        // Mark as collected for rendering
        const pu = this._powerups.find(p => p.id === powerupId);
        if (pu) pu.collected = true;

        // Particle burst at powerup location
        const pos = this._maze.powerups.find(p => p.id === powerupId);
        if (pos) {
          const cs = this._renderer._cellSize || 20;
          const color = type === 'speed_boost' ? '#00ccff' : '#aaddff';
          this._particles.addBurst(pos.x * cs + cs / 2, pos.y * cs + cs / 2, color);
        }

        if (playerId === this._myId) {
          this._powerupsCollected++;
          audio.playCollect();
          this._ui.updateHeldPowerups(this._heldPowerups);
        }
      }),

      // A powerup was activated (speed boost for self, freeze targeting someone)
      network.on('powerup-activated', ({ playerId, type, targetId }) => {
        if (type === 'speed_boost' && playerId === this._myId) {
          this._playerEffects.speed_boost = 5000;
          this._player.moveSpeed = SPEED_DURATION;
          audio.playSpeedBoost();
        }
      }),

      // A player got frozen
      network.on('player-frozen', ({ playerId, duration }) => {
        if (playerId === this._myId) {
          this._playerEffects.freeze = duration;
          this._ui.showFreezeOverlay(true);
          audio.playFreeze();
          const cs = this._renderer._cellSize || 20;
          this._particles.addFreezeHit(
            this._player.renderX * cs + cs / 2,
            this._player.renderY * cs + cs / 2,
          );
        }
      }),

      // Game over
      network.on('game-over', ({ winnerId, stats }) => {
        this._handleVSGameOver(winnerId, stats);
      }),

      // Opponent left mid-game
      network.on('opponent-disconnected', () => {
        if (this._gameState === 'finished') return;
        this._gameState = 'finished';
        input.disable();
        this._stopLoop();
        const oppEl = document.getElementById('opponent-hud-status');
        if (oppEl) oppEl.textContent = '● DISCONNECTED';
        setTimeout(() => {
          this._app.navigate('results', {
            mode:         'vs',
            won:          true,
            walkover:     true,
            config:       this._config,
            vsBot:        !!this._config?.vsBot,
            timeMs:       performance.now() - this._startTime,
            username:     this._app.getUsername(),
            opponentName: this._opponent?.name || 'OPPONENT',
          });
        }, 2000);
      }),
    );
  }

  _teardownNetwork() {
    this._netUnsubs.forEach(fn => fn());
    this._netUnsubs = [];
  }

  // ── Countdown ────────────────────────────────────────────────────────────────

  _startCountdown() {
    this._ui.showCountdown(3);
    audio.playCountdown(false);
    input.disable();
    input.flush();

    const ticks = [
      { delay: 1000, value: 2,    final: false },
      { delay: 2000, value: 1,    final: false },
      { delay: 3000, value: 'GO', final: true  },
      { delay: 3600, value: null               },
    ];

    ticks.forEach(({ delay, value, final }) => {
      setTimeout(() => {
        if (!this._el.classList.contains('active')) return;
        if (value === null) {
          this._ui.hideCountdown();
          this._gameState = 'playing';
          this._startTime = performance.now();
          input.enable();
          input.flush();
        } else {
          this._ui.showCountdown(value);
          audio.playCountdown(final);
        }
      }, delay);
    });

    this._startLoop();
  }

  // ── Game Loop ────────────────────────────────────────────────────────────────

  _startLoop() {
    if (this._animId) return;
    this._lastTs = performance.now();
    const loop = ts => {
      this._animId = requestAnimationFrame(loop);
      const dt = Math.min(50, ts - this._lastTs);
      this._lastTs = ts;
      this._update(ts, dt);
      this._render(ts);
    };
    this._animId = requestAnimationFrame(loop);
  }

  _stopLoop() {
    if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
  }

  // ── Update ───────────────────────────────────────────────────────────────────

  _update(ts, dt) {
    if (this._gameState === 'playing') {
      this._elapsedMs = ts - this._startTime;
      this._ui.updateTimer(this._elapsedMs);

      if (this._mode === 'solo') {
        this._score = calcScore(
          this._elapsedMs,
          this._maze.optimalPathLength,
          this._visitedCells.size,
          this._powerupsCollected,
          this._freezesUsed,
        );
        this._ui.updateScore(this._score);
      }

      // Powerup use input
      if (input.consumePowerupUse()) {
        this._usePowerup();
      }

      // Tick effect timers
      this._tickEffects(dt);
      this._updateEffectsHUD();

      this._processInput(ts);
      this._updatePlayerMovement(ts);
      this._updateOpponentSmooth();
      this._updateTrail(ts, dt);

    } else if (this._gameState === 'countdown') {
      this._updatePlayerMovement(ts);
      this._updateOpponentSmooth();
    }

    this._particles.update();
  }

  // ── Powerup Logic ────────────────────────────────────────────────────────────

  _tickEffects(dt) {
    if (this._playerEffects.speed_boost > 0) {
      this._playerEffects.speed_boost -= dt;
      if (this._playerEffects.speed_boost <= 0) {
        this._playerEffects.speed_boost = 0;
        this._player.moveSpeed = MOVE_DURATION;
      }
    }

    if (this._playerEffects.freeze > 0) {
      this._playerEffects.freeze -= dt;
      if (this._playerEffects.freeze <= 0) {
        this._playerEffects.freeze = 0;
        this._ui.showFreezeOverlay(false);
      }
    }
  }

  _updateEffectsHUD() {
    const effects = [];
    if (this._playerEffects.speed_boost > 0) {
      effects.push({ type: 'speed_boost', remaining: this._playerEffects.speed_boost });
    }
    if (this._playerEffects.freeze > 0) {
      effects.push({ type: 'freeze', remaining: this._playerEffects.freeze });
    }
    this._ui.updateEffects(effects);
  }

  _usePowerup() {
    if (this._heldPowerups.length === 0) return;
    const type = this._heldPowerups[0];

    if (this._mode === 'solo') {
      this._heldPowerups.shift();
      if (type === 'speed_boost') {
        this._playerEffects.speed_boost = 5000;
        this._player.moveSpeed = SPEED_DURATION;
        audio.playSpeedBoost();
      }
      // freeze: no target in solo — just discard
      this._ui.updateHeldPowerups(this._heldPowerups);

    } else {
      // VS: optimistically remove from UI, server is authoritative
      this._heldPowerups.shift();
      network.sendUsePowerup(type);
      this._ui.updateHeldPowerups(this._heldPowerups);

      // Optimistic speed_boost (server will confirm via powerup-activated)
      if (type === 'speed_boost') {
        this._playerEffects.speed_boost = 5000;
        this._player.moveSpeed = SPEED_DURATION;
        audio.playSpeedBoost();
      }
      // freeze: wait for server to send player-frozen to the target
      if (type === 'freeze') {
        this._freezesUsed++;
      }
    }
  }

  // ── Input & Movement ─────────────────────────────────────────────────────────

  _processInput(ts) {
    if (this._gameState !== 'playing') return;
    if (this._playerEffects.freeze > 0) return; // frozen — no movement

    const dir = input.consumeDirection() || (!this._player.isMoving && input.getHeldDir()) || null;
    if (!dir) return;

    if (this._player.isMoving) {
      this._player.bufferedDir = dir;
    } else {
      this._tryMove(dir, ts);
    }
  }

  _tryMove(dir, ts) {
    const { gridX, gridY } = this._player;
    const cellIdx = gridY * this._maze.width + gridX;
    const cell    = this._maze.cells[cellIdx];

    if (!cell || cell.walls[dir]) { audio.playBump(); return; }

    const dx = dir === 'e' ? 1 : dir === 'w' ? -1 : 0;
    const dy = dir === 's' ? 1 : dir === 'n' ? -1 : 0;
    const nx = gridX + dx;
    const ny = gridY + dy;

    if (nx < 0 || nx >= this._maze.width || ny < 0 || ny >= this._maze.height) return;

    // Optimistically apply move
    this._player.moveFrom      = { x: gridX, y: gridY };
    this._player.gridX         = nx;
    this._player.gridY         = ny;
    this._player.moveTo        = { x: nx, y: ny };
    this._player.moveStartTime = ts;
    this._player.isMoving      = true;
    this._visitedCells.add(`${nx},${ny}`);
    audio.playMove();

    // VS: tell server
    if (this._mode === 'vs') {
      this._seq++;
      network.sendInput(dir, this._seq);
    }

    // Solo: check powerup collection
    if (this._mode === 'solo') {
      const pu = this._powerups.find(p => !p.collected && p.x === nx && p.y === ny);
      if (pu) {
        pu.collected = true;
        this._heldPowerups.push(pu.type);
        this._powerupsCollected++;
        audio.playCollect();
        const cs = this._renderer._cellSize || 20;
        const color = pu.type === 'speed_boost' ? '#00ccff' : '#aaddff';
        this._particles.addBurst(nx * cs + cs / 2, ny * cs + cs / 2, color);
        this._ui.updateHeldPowerups(this._heldPowerups);
      }
    }

    // Win check
    if (nx === this._maze.exit.x && ny === this._maze.exit.y) {
      this._player.bufferedDir = null;
      setTimeout(() => {
        if (this._mode === 'solo') this._handleSoloWin();
        // VS: server will send game-over
      }, this._player.moveSpeed + 50);
    }
  }

  _updatePlayerMovement(ts) {
    const p = this._player;
    if (!p.isMoving) return;

    const t     = Math.min(1, (ts - p.moveStartTime) / p.moveSpeed);
    const eased = easeOutCubic(t);
    p.renderX = lerp(p.moveFrom.x, p.moveTo.x, eased);
    p.renderY = lerp(p.moveFrom.y, p.moveTo.y, eased);

    if (t >= 1) {
      p.renderX  = p.gridX;
      p.renderY  = p.gridY;
      p.isMoving = false;

      if (!p.bufferedDir && this._gameState === 'playing') {
        p.bufferedDir = input.getHeldDir();
      }

      if (p.bufferedDir && this._gameState === 'playing') {
        const buf = p.bufferedDir;
        p.bufferedDir = null;
        this._tryMove(buf, performance.now());
      }
    }
  }

  _updateOpponentSmooth() {
    const o = this._opponent;
    if (!o) return;
    const SMOOTH = 0.25;
    o.renderX += (o.gridX - o.renderX) * SMOOTH;
    o.renderY += (o.gridY - o.renderY) * SMOOTH;
  }

  _updateTrail(ts, dt) {
    this._trailTimer += dt;
    if (this._trailTimer < TRAIL_INTERVAL || !this._player.isMoving) return;
    this._trailTimer = 0;

    const cs = this._renderer._cellSize || 20;
    const wx = this._player.renderX * cs + cs / 2;
    const wy = this._player.renderY * cs + cs / 2;

    if (this._playerEffects.speed_boost > 0) {
      // Extra speed stream particles when boosted
      this._particles.addSpeedStream(wx, wy, '#00ccff');
      this._particles.addSpeedStream(wx, wy, '#00ccff');
    }
    this._particles.addTrail(wx, wy, 'rgba(0,255,245,0.5)');
  }

  // ── Win / Game Over ──────────────────────────────────────────────────────────

  _handleSoloWin() {
    if (this._gameState !== 'playing') return;
    this._gameState = 'finished';
    this._elapsedMs = performance.now() - this._startTime;

    input.disable();
    audio.playWin();

    const cs = this._renderer._cellSize || 20;
    this._particles.addWin(
      this._maze.exit.x * cs + cs / 2,
      this._maze.exit.y * cs + cs / 2,
    );

    this._streak++;
    localStorage.setItem('mw_streak', this._streak);

    // Final score with powerup bonuses
    this._score = calcScore(
      this._elapsedMs,
      this._maze.optimalPathLength,
      this._visitedCells.size,
      this._powerupsCollected,
      this._freezesUsed,
    );

    // Record to server (non-blocking, non-critical)
    fetch('/api/solo', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        username:          this._app.getUsername(),
        level:             this._level,
        timeMs:            this._elapsedMs,
        powerupsCollected: this._powerupsCollected,
        freezesUsed:       this._freezesUsed,
      }),
    }).catch(() => {}); // ignore errors — stats are non-critical

    setTimeout(() => {
      this._app.navigate('results', {
        mode:              'solo',
        timeMs:            this._elapsedMs,
        score:             this._score,
        optimalPath:       this._maze.optimalPathLength,
        visitedCount:      this._visitedCells.size,
        level:             this._level,
        username:          this._app.getUsername(),
        config:            this._config,
        powerupsCollected: this._powerupsCollected,
        freezesUsed:       this._freezesUsed,
      });
    }, 1800);
  }

  _handleVSGameOver(winnerId, stats) {
    if (this._gameState === 'finished') return;
    this._gameState = 'finished';

    input.disable();
    this._stopLoop();

    const won = winnerId === this._myId;

    if (won) {
      audio.playWin();
      const cs = this._renderer._cellSize || 20;
      this._particles.addWin(
        this._maze.exit.x * cs + cs / 2,
        this._maze.exit.y * cs + cs / 2,
      );
    }

    this._showOutcome(won ? 'YOU WIN!' : 'YOU LOSE', won ? 'var(--neon-green)' : 'var(--danger-red)');

    setTimeout(() => {
      this._app.navigate('results', {
        mode:         'vs',
        won,
        winnerId,
        stats,
        myId:         this._myId,
        username:     this._app.getUsername(),
        opponentName: this._opponent?.name || 'OPPONENT',
        config:       this._config,
        vsBot:        !!this._config?.vsBot,
      });
    }, 2200);
  }

  // ── Outcome overlay ──────────────────────────────────────────────────────────

  _showOutcome(text, color) {
    const ov = document.getElementById('outcome-overlay');
    const tx = document.getElementById('outcome-text');
    if (ov && tx) {
      tx.textContent      = text;
      tx.style.color      = color;
      tx.style.textShadow = `0 0 30px ${color}`;
      ov.classList.remove('hidden');
    }
  }

  _hideOutcome() {
    const ov = document.getElementById('outcome-overlay');
    if (ov) ov.classList.add('hidden');
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  _render(ts) {
    this._renderer.render(
      {
        player:       this._player,
        opponent:     this._opponent,
        visitedCells: this._visitedCells,
        powerups:     this._powerups,
      },
      this._particles,
      ts,
    );
  }
}

// ── Math helpers ─────────────────────────────────────────────────────────────
function lerp(a, b, t)   { return a + (b - a) * t; }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
