/**
 * UI MANAGER
 * Updates DOM-based HUD elements from game state.
 */

function fmt(ms) {
  const totalMs  = Math.floor(ms);
  const minutes  = Math.floor(totalMs / 60000);
  const seconds  = Math.floor((totalMs % 60000) / 1000);
  const millis   = totalMs % 1000;
  return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}.${String(millis).padStart(3,'0')}`;
}

function fmtNum(n) {
  return n.toLocaleString();
}

export class UIManager {
  constructor() {
    this._timer   = document.getElementById('timer-display');
    this._level   = document.getElementById('level-display');
    this._score   = document.getElementById('score-display');
    this._streak  = document.getElementById('streak-display');
    this._elo     = document.getElementById('elo-display');
    this._effects = document.getElementById('effects-display');
    this._held    = document.getElementById('held-display');
    this._cdOverlay = document.getElementById('countdown-overlay');
    this._cdNum     = document.getElementById('countdown-num');
    this._freezeOv  = document.getElementById('freeze-overlay');
    // Mobile HUD elements (visible when sidebar is hidden on small screens)
    this._mhudTimer = document.getElementById('mhud-timer');
    this._mhudInfo  = document.getElementById('mhud-info');
    this._mhudHeld  = document.getElementById('mhud-held');
  }

  updateTimer(ms) {
    const f = fmt(ms);
    if (this._timer) this._timer.textContent = f;
    if (this._mhudTimer) this._mhudTimer.textContent = f;
  }

  updateLevel(level) {
    if (this._level) this._level.textContent = level;
    if (this._mhudInfo) this._mhudInfo.textContent = `LVL ${level}`;
  }

  updateScore(score) {
    if (this._score) this._score.textContent = fmtNum(Math.floor(score));
  }

  updateStreak(streak) {
    if (this._streak) this._streak.textContent = streak;
  }

  updateElo(elo) {
    if (this._elo) this._elo.textContent = elo;
  }

  updateEffects(effects) {
    if (!this._effects) return;

    if (!effects || effects.length === 0) {
      this._effects.innerHTML = '<span class="no-effects">— NONE —</span>';
      return;
    }

    this._effects.innerHTML = effects.map(ef => {
      const cls  = ef.type === 'speed_boost' ? 'speed' : 'freeze';
      const icon = ef.type === 'speed_boost' ? '⚡' : '❄';
      const label = ef.type === 'speed_boost' ? 'SPEED' : 'FROZEN';
      const secs  = ef.remaining > 0 ? ` ${(ef.remaining / 1000).toFixed(1)}s` : '';
      return `<div class="effect-badge ${cls}">${icon} ${label}${secs}</div>`;
    }).join('');
  }

  updateHeldPowerups(powerups) {
    if (this._held) {
      if (!powerups || powerups.length === 0) {
        this._held.innerHTML = '<span class="no-effects">— NONE —</span>';
      } else {
        this._held.innerHTML = powerups.map(type => {
          const icon  = type === 'speed_boost' ? '⚡' : '❄';
          const label = type === 'speed_boost' ? 'SPEED' : 'FREEZE';
          const cls   = type === 'speed_boost' ? 'speed' : 'freeze';
          return `<div class="effect-badge ${cls}">${icon} ${label}</div>`;
        }).join('');
      }
    }
    // Mobile HUD: show icons only (compact)
    if (this._mhudHeld) {
      this._mhudHeld.textContent = (powerups || [])
        .map(t => t === 'speed_boost' ? '⚡' : '❄').join(' ');
    }
  }

  showCountdown(value) {
    if (!this._cdOverlay) return;
    if (value === 'GO') {
      this._cdNum.textContent = 'GO!';
      this._cdNum.style.color = 'var(--neon-green)';
      this._cdNum.style.textShadow = '0 0 30px var(--neon-green), 0 0 80px rgba(57,255,20,0.5)';
    } else {
      this._cdNum.textContent = value;
      this._cdNum.style.color = '';
      this._cdNum.style.textShadow = '';
    }
    this._cdOverlay.classList.remove('hidden');

    // Trigger re-animation by cloning
    const old = this._cdNum;
    const fresh = old.cloneNode(true);
    old.parentNode.replaceChild(fresh, old);
    this._cdNum = fresh;
  }

  hideCountdown() {
    if (this._cdOverlay) this._cdOverlay.classList.add('hidden');
  }

  showFreezeOverlay(show) {
    if (!this._freezeOv) return;
    if (show) this._freezeOv.classList.remove('hidden');
    else      this._freezeOv.classList.add('hidden');
  }

  updateOpponent(name, status) {
    const nameEl   = document.getElementById('opponent-name-hud');
    const statusEl = document.getElementById('opponent-hud-status');
    if (nameEl   && name   != null) nameEl.textContent   = name;
    if (statusEl && status != null) statusEl.textContent = status;
  }
}
