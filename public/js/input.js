/**
 * INPUT MANAGER
 * Keyboard and touch input handling.
 * Consumers check getDirection() each frame.
 */

const DIR_KEYS = {
  ArrowUp:    'n', KeyW: 'n', KeyK: 'n',
  ArrowDown:  's', KeyS: 's', KeyJ: 's',
  ArrowRight: 'e', KeyD: 'e', KeyL: 'e',
  ArrowLeft:  'w', KeyA: 'w', KeyH: 'w',
};

const POWERUP_KEYS = new Set(['Space', 'KeyF', 'KeyE']);

export class InputManager {
  constructor() {
    this._queued        = null;   // buffered direction
    this._heldDir       = null;   // direction key currently held down
    this._powerupQueued = false;  // powerup use request
    this._enabled       = false;
    this._handlers      = {};

    this._onKeyDown = this._handleKey.bind(this);
    this._onKeyUp   = this._handleKeyUp.bind(this);
    this._onTouchStart = null;
    this._touchStartX = 0;
    this._touchStartY = 0;
  }

  enable() {
    this._enabled = true;
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup',   this._onKeyUp);
    this._setupTouch();
    this._setupDpad();
  }

  disable() {
    this._enabled = false;
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup',   this._onKeyUp);
    this._heldDir = null;
    this._removeTouch();
  }

  _handleKey(e) {
    if (!this._enabled) return;
    const dir = DIR_KEYS[e.code];
    if (dir) {
      e.preventDefault();
      this._heldDir = dir;
      this._queued  = dir;
      return;
    }
    if (POWERUP_KEYS.has(e.code)) {
      e.preventDefault();
      this._powerupQueued = true;
    }
  }

  _handleKeyUp(e) {
    const dir = DIR_KEYS[e.code];
    if (dir && this._heldDir === dir) {
      this._heldDir = null;
    }
  }

  // The direction currently held (for game-driven repeat)
  getHeldDir() { return this._heldDir; }

  _setupTouch() {
    const area = document.getElementById('game-area');
    if (!area) return;

    this._onTouchStart = (e) => {
      this._touchStartX = e.touches[0].clientX;
      this._touchStartY = e.touches[0].clientY;
    };

    this._onTouchEnd = (e) => {
      if (!this._enabled) return;
      const dx = e.changedTouches[0].clientX - this._touchStartX;
      const dy = e.changedTouches[0].clientY - this._touchStartY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (Math.max(absDx, absDy) < 20) return; // too short

      if (absDx > absDy) {
        this._queued = dx > 0 ? 'e' : 'w';
      } else {
        this._queued = dy > 0 ? 's' : 'n';
      }
    };

    area.addEventListener('touchstart', this._onTouchStart, { passive: true });
    area.addEventListener('touchend',   this._onTouchEnd,   { passive: true });
    this._touchArea = area;
  }

  _removeTouch() {
    if (this._touchArea) {
      this._touchArea.removeEventListener('touchstart', this._onTouchStart);
      this._touchArea.removeEventListener('touchend',   this._onTouchEnd);
    }
  }

  _setupDpad() {
    const dpad = document.getElementById('dpad');
    if (!dpad) return;
    dpad.querySelectorAll('.dpad-btn').forEach(btn => {
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (this._enabled) this._queued = btn.dataset.dir;
      }, { passive: false });
      btn.addEventListener('mousedown', () => {
        if (this._enabled) this._queued = btn.dataset.dir;
      });
    });
  }

  // Consume the queued direction (returns it and clears)
  consumeDirection() {
    const d = this._queued;
    this._queued = null;
    return d;
  }

  // Consume the powerup-use request
  consumePowerupUse() {
    const v = this._powerupQueued;
    this._powerupQueued = false;
    return v;
  }

  // Peek without consuming
  peek() { return this._queued; }

  // Clear any queued input
  flush() { this._queued = null; this._heldDir = null; this._powerupQueued = false; }
}

export const input = new InputManager();
