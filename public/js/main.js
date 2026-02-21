/**
 * MAZE WARS — Main Entry Point
 * App-level screen management, username, and navigation.
 */

import { MenuScreen }        from './screens/menu.js';
import { LobbyScreen }       from './screens/lobby.js';
import { GameScreen }        from './screens/game.js';
import { ResultsScreen }     from './screens/results.js';
import { LeaderboardScreen } from './screens/leaderboard.js';
import { ProfileScreen }     from './screens/profile.js';
import { ApiDocsScreen }     from './screens/apidocs.js';

class App {
  constructor() {
    this._screens       = {};
    this._currentScreen = null;
    this._username      = this._loadUsername();
    this._init();
  }

  // ─── Username ────────────────────────────────────────────────────────────────

  _loadUsername() {
    return localStorage.getItem('mw_username') || 'GHOST';
  }

  _saveUsername(name) {
    const clean = name.trim().toUpperCase().replace(/[^A-Z0-9_\-]/g, '').slice(0, 16) || 'GHOST';
    localStorage.setItem('mw_username', clean);
    this._username = clean;
    return clean;
  }

  getUsername() { return this._username; }

  promptUsername() {
    const modal   = document.getElementById('modal-username');
    const input   = document.getElementById('username-input');
    const confirm = document.getElementById('btn-username-confirm');
    const cancel  = document.getElementById('btn-username-cancel');

    input.value = this._username === 'GHOST' ? '' : this._username;
    modal.classList.remove('hidden');
    input.focus();

    const close = () => modal.classList.add('hidden');

    const doConfirm = () => {
      const name = this._saveUsername(input.value);
      const el   = document.getElementById('menu-username');
      if (el) el.textContent = name;
      close();
    };

    const onKey = (e) => {
      if (e.key === 'Enter')  doConfirm();
      if (e.key === 'Escape') close();
    };

    confirm.onclick = doConfirm;
    cancel.onclick  = close;
    input.onkeydown = onKey;
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  _init() {
    this._screens.menu        = new MenuScreen(this);
    this._screens.lobby       = new LobbyScreen(this);
    this._screens.game        = new GameScreen(this);
    this._screens.results     = new ResultsScreen(this);
    this._screens.leaderboard = new LeaderboardScreen(this);
    this._screens.profile     = new ProfileScreen(this);
    this._screens.apidocs     = new ApiDocsScreen(this);

    this._setupFirstVisit();
    this.navigate('menu');
  }

  // ─── First Visit ─────────────────────────────────────────────────────────────

  _setupFirstVisit() {
    if (this._username === 'GHOST' && !localStorage.getItem('mw_visited')) {
      localStorage.setItem('mw_visited', '1');
      setTimeout(() => this.promptUsername(), 800);
    }
  }

  // ─── Navigation ──────────────────────────────────────────────────────────────

  navigate(screenName, data = {}) {
    const next = this._screens[screenName];
    if (!next) {
      console.error(`Unknown screen: ${screenName}`);
      return;
    }

    const doShow = () => {
      this._currentScreen = next;
      // Start transparent so the CSS transition fades it in
      next._el.style.opacity = '0';
      next.show(data);
      next._el.offsetHeight; // force reflow — transition starts from 0
      next._el.style.opacity = '';
    };

    if (!this._currentScreen) {
      doShow();
      return;
    }

    const prev = this._currentScreen;
    if (prev === next) {
      prev.hide();
      doShow();
      return;
    }

    // Fade out: the CSS `transition: opacity 0.3s` on .screen handles animation
    prev._el.style.opacity = '0';
    setTimeout(() => {
      prev._el.style.opacity = '';
      prev.hide();
      doShow();
    }, 310); // slightly more than --transition-speed (0.3s)
  }
}

// Boot
const app = new App();
