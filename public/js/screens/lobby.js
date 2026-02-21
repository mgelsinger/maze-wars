/**
 * LOBBY SCREEN
 * Manages all lobby sub-panels: mode select, solo config, VS create/join/wait/connected.
 * Delegates network events to navigate into the game screen.
 */

import { network } from '../network.js';
import { audio }   from '../audio.js';

export class LobbyScreen {
  constructor(app) {
    this._app          = app;
    this._el           = document.getElementById('screen-lobby');
    this._unsubs       = [];         // cleanup fns
    this._soloLevel    = 1;
    this._vsLevel      = 1;
    this._roomCode     = null;
    this._opponentName = null;
    this._myReady      = false;
    this._vsBot        = false;

    this._bindEvents();
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  show() {
    this._el.classList.add('active');
    this._showPanel('mode');
    this._setupNetworkListeners();
  }

  hide() {
    this._el.classList.remove('active');
    this._teardownNetwork();
  }

  // ── Panel Router ────────────────────────────────────────────────────────────

  _showPanel(name) {
    this._el.querySelectorAll('.lobby-panel').forEach(p => {
      p.classList.toggle('hidden', p.dataset.panel !== name);
    });
  }

  // ── Static Event Bindings ───────────────────────────────────────────────────

  _bindEvents() {
    // Mode panel
    this._on('lobby-card-solo', 'click', () => this._showPanel('solo'));
    this._on('lobby-card-vs',   'click', () => {
      network.connect();
      this._showPanel('vs-choose');
    });
    this._on('lobby-card-matchmaking', 'click', () => {
      network.connect();
      this._startMatchmaking();
    });
    this._on('lobby-card-vs-bot', 'click', () => {
      network.connect();
      this._showPanel('vs-bot');
    });
    this._on('btn-lobby-to-menu', 'click', () => this._app.navigate('menu'));

    // Solo panel
    this._el.querySelectorAll('#panel-solo .size-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        this._el.querySelectorAll('#panel-solo .size-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._soloLevel = +btn.dataset.level;
      })
    );
    this._on('btn-launch-solo', 'click', () => {
      audio.init();
      this._app.navigate('game', { mode: 'solo', level: this._soloLevel });
    });
    this._on('btn-solo-back', 'click', () => this._showPanel('mode'));

    // VS choose panel
    this._on('btn-create-room', 'click', () => {
      audio.init();
      network.createRoom(this._app.getUsername(), this._vsLevel);
    });
    this._el.querySelectorAll('#panel-vs-choose .size-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        this._el.querySelectorAll('#panel-vs-choose .size-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._vsLevel = +btn.dataset.level;
      })
    );
    this._on('btn-vs-back', 'click', () => this._showPanel('mode'));

    // Room code input — uppercase + alpha only
    const codeInput = document.getElementById('room-code-input');
    if (codeInput) {
      codeInput.addEventListener('input', e => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      });
      codeInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('btn-join-confirm')?.click();
      });
    }
    this._on('btn-join-confirm', 'click', () => {
      audio.init();
      const code = (document.getElementById('room-code-input')?.value || '').trim();
      if (code.length !== 6) { this._showError('Enter a 6-character room code'); return; }
      network.joinRoom(code, this._app.getUsername());
    });

    // Matchmaking cancel
    this._on('btn-cancel-matchmaking', 'click', () => {
      network.emit('cancel-matchmaking', {});
      this._vsBot = false;
      this._showPanel('vs-choose');
    });

    // VS BOT panel
    this._on('btn-vs-bot-back', 'click', () => this._showPanel('mode'));
    this._el.querySelectorAll('#panel-vs-bot .diff-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._el.querySelectorAll('#panel-vs-bot .diff-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
    this._el.querySelectorAll('#panel-vs-bot .size-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._el.querySelectorAll('#panel-vs-bot .size-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
    this._on('btn-launch-bot', 'click', () => {
      audio.init();
      const diffBtn  = this._el.querySelector('#panel-vs-bot .diff-btn.active');
      const sizeBtn  = this._el.querySelector('#panel-vs-bot .size-btn.active');
      const difficulty = diffBtn?.dataset.diff   || 'medium';
      const level      = +(sizeBtn?.dataset.level || 1);
      this._startBotGame(difficulty, level);
    });

    // VS waiting panel
    this._on('btn-copy-code', 'click', () => {
      if (this._roomCode && navigator.clipboard) {
        navigator.clipboard.writeText(this._roomCode).then(() => {
          const btn = document.getElementById('btn-copy-code');
          if (btn) { btn.textContent = 'COPIED!'; setTimeout(() => { if (btn) btn.textContent = 'COPY'; }, 2000); }
        });
      }
    });
    this._on('btn-cancel-room', 'click', () => {
      network.leaveRoom();
      this._roomCode = null;
      this._showPanel('vs-choose');
    });

    // VS connected (ready) panel
    this._on('btn-ready', 'click', () => {
      if (this._myReady) return;
      this._myReady = true;
      network.sendReady();
      const btn = document.getElementById('btn-ready');
      if (btn) { btn.disabled = true; btn.textContent = 'WAITING...'; }
    });
    this._on('btn-vs-leave', 'click', () => {
      network.leaveRoom();
      this._roomCode     = null;
      this._opponentName = null;
      this._showPanel('mode');
    });
  }

  _on(id, event, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
  }

  // ── Network ─────────────────────────────────────────────────────────────────

  _setupNetworkListeners() {
    this._unsubs.push(
      network.on('room-created', ({ roomCode }) => {
        this._roomCode = roomCode;
        const el = document.getElementById('room-code-display');
        if (el) el.textContent = roomCode;
        this._showPanel('vs-waiting');
      }),

      network.on('opponent-joined', ({ opponent }) => {
        this._opponentName = opponent.name;
        this._enterConnected();
      }),

      network.on('room-joined', ({ roomCode, opponent }) => {
        this._roomCode     = roomCode;
        this._opponentName = opponent?.name || null;
        this._enterConnected();
      }),

      // Matchmaking found a game — same as room-joined but no ready handshake needed
      network.on('match-found', ({ roomCode, opponent, vsBot }) => {
        this._roomCode     = roomCode;
        this._opponentName = opponent?.name || null;
        if (vsBot) this._vsBot = true;
        this._updateMatchmakingStatus(`MATCHED! vs ${this._opponentName} — STARTING...`);
        // Game will auto-start — just wait for game-start event
      }),

      network.on('matchmaking-status', ({ inQueue }) => {
        this._updateMatchmakingStatus(`SEARCHING... (${inQueue} in queue)`);
      }),

      network.on('matchmaking-cancelled', () => {
        this._showPanel('vs-choose');
      }),

      // Game starting — navigate to game screen
      network.on('game-start', data => {
        this._app.navigate('game', {
          mode:         'vs',
          roomCode:     this._roomCode,
          opponentName: this._opponentName || data.opponentName,
          vsBot:        this._vsBot,
          ...data,
        });
        this._vsBot = false;
      }),

      network.on('rematch-ready', ({ opponentName }) => {
        if (opponentName) this._opponentName = opponentName;
        this._enterConnected();
      }),

      network.on('error', ({ message }) => {
        this._showError(message);
      }),

      network.on('opponent-disconnected', () => {
        this._showError('Opponent disconnected');
        this._showPanel('vs-choose');
      }),
    );
  }

  _teardownNetwork() {
    this._unsubs.forEach(fn => fn());
    this._unsubs = [];
  }

  _startMatchmaking() {
    audio.init();
    this._vsBot = false;
    network.emit('find-match', { playerName: this._app.getUsername() });
    this._updateMatchmakingStatus('SEARCHING...');
    this._showPanel('matchmaking');
  }

  _startBotGame(difficulty, level) {
    this._vsBot = true;
    const diffLabel = { easy: 'EASY', medium: 'MEDIUM', hard: 'HARD' }[difficulty] || difficulty.toUpperCase();
    this._updateMatchmakingStatus(`PREPARING ${diffLabel} BOT...`);
    this._showPanel('matchmaking');
    network.emit('create-bot-room', {
      playerName: this._app.getUsername(),
      difficulty,
      level,
    });
  }

  _updateMatchmakingStatus(msg) {
    const el = document.getElementById('matchmaking-status');
    if (el) el.textContent = msg;
  }

  _enterConnected() {
    this._myReady = false;
    document.getElementById('connected-room-code').textContent   = this._roomCode || '------';
    document.getElementById('vs-your-name').textContent          = this._app.getUsername();
    document.getElementById('vs-opponent-name').textContent      = this._opponentName || '---';
    const btn = document.getElementById('btn-ready');
    if (btn) { btn.disabled = false; btn.textContent = 'READY!'; }
    this._showPanel('vs-connected');
  }

  _showError(msg) {
    const el = document.getElementById('lobby-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el?.classList.add('hidden'), 3500);
  }
}
