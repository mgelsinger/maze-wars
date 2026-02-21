/**
 * RESULTS SCREEN
 * Post-game results display — supports both solo and VS modes.
 */

import { network } from '../network.js';

function fmt(ms) {
  const totalMs = Math.floor(ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis  = totalMs % 1000;
  return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}.${String(millis).padStart(3,'0')}`;
}

function animateCount(el, from, to, duration, suffix = '', formatter = null) {
  if (!el) return;
  const start  = performance.now();
  const update = (ts) => {
    const p    = Math.min(1, (ts - start) / duration);
    const ease = 1 - Math.pow(1 - p, 3); // ease-out cubic
    const val  = Math.round(from + (to - from) * ease);
    el.textContent = formatter ? formatter(val) : (val + suffix);
    if (p < 1) requestAnimationFrame(update);
    else el.textContent = formatter ? formatter(to) : (to + suffix);
  };
  requestAnimationFrame(update);
}

export class ResultsScreen {
  constructor(app) {
    this._app     = app;
    this._el      = document.getElementById('screen-results');
    this._data    = null;
    this._netUnsub = null;   // VS network listener cleanup

    this._bindEvents();
  }

  _bindEvents() {
    document.getElementById('btn-play-again')
      ?.addEventListener('click', () => {
        if (this._data?.config) this._app.navigate('game', this._data.config);
      });

    document.getElementById('btn-results-lobby')
      ?.addEventListener('click', () => {
        if (this._data?.mode === 'vs') network.leaveRoom();
        this._app.navigate('lobby');
      });

    document.getElementById('btn-results-menu')
      ?.addEventListener('click', () => {
        if (this._data?.mode === 'vs') network.leaveRoom();
        this._app.navigate('menu');
      });

    document.getElementById('btn-rematch')
      ?.addEventListener('click', () => {
        network.sendRematch();
        const btn = document.getElementById('btn-rematch');
        if (btn) { btn.disabled = true; btn.textContent = 'WAITING...'; }
      });
  }

  show(data) {
    this._data = data;
    this._el.classList.add('active');
    if (data.mode === 'vs') {
      this._populateVS(data);
    } else {
      this._populateSolo(data);
    }
  }

  hide() {
    this._el.classList.remove('active');
    if (this._netUnsub) { this._netUnsub(); this._netUnsub = null; }
  }

  // ── Solo ────────────────────────────────────────────────────────────────────

  _populateSolo(data) {
    // Toggle sections
    document.getElementById('vs-results-cards')?.classList.add('hidden');
    document.getElementById('solo-results-card')?.classList.remove('hidden');
    document.getElementById('solo-breakdown')?.classList.remove('hidden');
    document.getElementById('btn-play-again')?.classList.remove('hidden');
    document.getElementById('btn-results-lobby')?.classList.remove('hidden');
    document.getElementById('btn-rematch')?.classList.add('hidden');

    const { timeMs, optimalPath, visitedCount, username,
            powerupsCollected = 0, freezesUsed = 0 } = data;

    document.getElementById('results-outcome').textContent       = 'MAZE CLEARED!';
    document.getElementById('results-sub').textContent           = 'RUN COMPLETE';
    document.getElementById('results-player-name').textContent   = username || 'GHOST';
    document.getElementById('res-time').textContent              = fmt(timeMs);
    document.getElementById('res-cells').textContent             = visitedCount;
    document.getElementById('res-optimal').textContent           = optimalPath;
    document.getElementById('res-powerups').textContent          = powerupsCollected;
    document.getElementById('res-freezes').textContent           = freezesUsed;

    const efficiency = optimalPath > 0
      ? Math.round((optimalPath / Math.max(optimalPath, visitedCount)) * 100)
      : 0;
    document.getElementById('res-efficiency').textContent = efficiency + '%';

    const base        = 1000;
    const timeBonus   = Math.max(0, Math.floor(5000 - timeMs / 100));
    const effBonus    = optimalPath > 0
      ? Math.floor((optimalPath / Math.max(optimalPath, visitedCount)) * 1000)
      : 0;
    const puBonus     = powerupsCollected * 200;
    const freezeBonus = freezesUsed * 300;
    const total       = base + timeBonus + effBonus + puBonus + freezeBonus;

    document.getElementById('res-base').textContent         = `+${base}`;
    document.getElementById('res-time-bonus').textContent   = `+${timeBonus}`;
    document.getElementById('res-eff-bonus').textContent    = `+${effBonus}`;
    document.getElementById('res-pu-bonus').textContent     = `+${puBonus}`;
    document.getElementById('res-freeze-bonus').textContent = `+${freezeBonus}`;

    animateCount(document.getElementById('res-score'), 0, total, 1200, '', v => v.toLocaleString());
    animateCount(document.getElementById('res-total'), 0, total, 1400, '', v => v.toLocaleString());
  }

  // ── VS ──────────────────────────────────────────────────────────────────────

  _populateVS(data) {
    const { won, walkover, stats, myId, username, opponentName, vsBot } = data;

    // Toggle sections
    document.getElementById('vs-results-cards')?.classList.remove('hidden');
    document.getElementById('solo-results-card')?.classList.add('hidden');
    document.getElementById('solo-breakdown')?.classList.add('hidden');
    // VS BOT: show "Play Again" instead of "Rematch" (no ELO, no rematch vote needed)
    document.getElementById('btn-play-again')?.classList.toggle('hidden', !vsBot);
    document.getElementById('btn-rematch')?.classList.toggle('hidden', !!vsBot);

    // Reset rematch button
    const rematchBtn = document.getElementById('btn-rematch');
    if (rematchBtn) { rematchBtn.disabled = false; rematchBtn.textContent = 'REMATCH'; }

    // Header
    if (walkover) {
      document.getElementById('results-outcome').textContent = 'YOU WIN!';
      document.getElementById('results-sub').textContent     = 'OPPONENT DISCONNECTED';
    } else {
      document.getElementById('results-outcome').textContent = won ? 'YOU WIN!' : 'YOU LOSE';
      document.getElementById('results-sub').textContent     = won ? 'VICTORY'  : 'DEFEAT';
    }

    // Find per-player stats from server payload
    const myStats  = stats?.players?.find(p => p.id === myId)
      ?? { name: username || 'YOU',         time: null, won: !!won };
    const oppStats = stats?.players?.find(p => p.id !== myId)
      ?? { name: opponentName || 'OPPONENT', time: null, won: !won };

    document.getElementById('res-name-you').textContent = myStats.name  || username     || 'YOU';
    document.getElementById('res-name-opp').textContent = oppStats.name || opponentName || 'OPPONENT';

    document.getElementById('res-time-you').textContent =
      myStats.time  != null ? fmt(myStats.time)  : '--:--';
    document.getElementById('res-time-opp').textContent =
      oppStats.time != null ? fmt(oppStats.time) : '--:--';

    // Powerup stats
    const setPU = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? '--'; };
    setPU('res-pu-you',  myStats.powerupsCollected);
    setPU('res-fr-you',  myStats.freezesUsed);
    setPU('res-pu-opp',  oppStats.powerupsCollected);
    setPU('res-fr-opp',  oppStats.freezesUsed);

    // ELO delta
    const eloChange = stats?.eloChanges?.[myId];
    const newElo    = stats?.newElos?.[myId];
    const eloEl     = document.getElementById('res-elo-delta');
    if (eloEl && eloChange != null) {
      const sign  = eloChange >= 0 ? '+' : '';
      const color = eloChange >= 0 ? 'var(--neon-green)' : 'var(--danger-red)';
      eloEl.textContent  = `${sign}${eloChange} ELO${newElo != null ? ` → ${newElo}` : ''}`;
      eloEl.style.color  = color;
      eloEl.classList.remove('hidden');
    } else if (eloEl) {
      eloEl.classList.add('hidden');
    }

    // Crowns
    document.getElementById('res-crown-you')?.classList.toggle('hidden', !myStats.won);
    document.getElementById('res-crown-opp')?.classList.toggle('hidden', !oppStats.won);

    // ── Network listeners while results is active ────────────────────────────
    if (this._netUnsub) { this._netUnsub(); this._netUnsub = null; }

    const unsubVote = network.on('rematch-vote', ({ votes, needed }) => {
      // One player voted; update button text
      if (rematchBtn && rematchBtn.disabled) {
        rematchBtn.textContent = `WAITING... (${votes}/${needed})`;
      }
    });

    // When both players voted, server sends rematch-ready then game-start almost
    // immediately. Handle game-start directly here so we don't miss it.
    const unsubStart = network.on('game-start', startData => {
      this._app.navigate('game', {
        mode:         'vs',
        roomCode:     this._data?.config?.roomCode,
        opponentName: startData.opponentName || opponentName,
        ...startData,
      });
    });

    this._netUnsub = () => { unsubVote(); unsubStart(); };
  }
}
