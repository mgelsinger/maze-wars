/**
 * PROFILE SCREEN
 * Displays the current player's stats fetched from /api/player/:username
 */

function fmtMs(ms) {
  if (ms == null) return '—';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const c = ms % 1000;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(c).padStart(3,'0')}`;
}

export class ProfileScreen {
  constructor(app) {
    this._app = app;
    this._el  = document.getElementById('screen-profile');
    this._bindEvents();
  }

  show() {
    this._el.classList.add('active');
    this._load();
  }

  hide() {
    this._el.classList.remove('active');
  }

  _bindEvents() {
    document.getElementById('btn-prof-back')
      ?.addEventListener('click', () => this._app.navigate('menu'));
    document.getElementById('btn-prof-edit')
      ?.addEventListener('click', () => this._app.promptUsername());
    document.getElementById('btn-prof-refresh')
      ?.addEventListener('click', () => this._load());
  }

  _load() {
    const username = this._app.getUsername();
    const statusEl = document.getElementById('prof-status');
    if (statusEl) statusEl.textContent = 'LOADING...';

    fetch(`/api/player/${encodeURIComponent(username)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) {
          this._populateEmpty(username);
        } else {
          this._populate(data);
        }
      })
      .catch(() => this._populateEmpty(username));
  }

  _set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? '—';
  }

  _populateEmpty(username) {
    this._set('prof-username',    username);
    this._set('prof-elo',         '1000');
    this._set('prof-games',       '0');
    this._set('prof-wins',        '0');
    this._set('prof-winrate',     '—');
    this._set('prof-best-15',     '—');
    this._set('prof-best-21',     '—');
    this._set('prof-best-31',     '—');
    this._set('prof-best-41',     '—');
    this._set('prof-streak',      '0');
    this._set('prof-best-streak', '0');
    this._set('prof-powerups',    '0');
    this._set('prof-freezes',     '0');
    this._set('prof-status',      'NO GAMES PLAYED YET');
  }

  _populate(d) {
    const winRate = d.games_played > 0
      ? Math.round((d.games_won / d.games_played) * 100) + '%'
      : '—';

    this._set('prof-username',    d.username);
    this._set('prof-elo',         d.elo);
    this._set('prof-games',       d.games_played);
    this._set('prof-wins',        d.games_won);
    this._set('prof-winrate',     winRate);
    this._set('prof-best-15',     fmtMs(d.best_time_15));
    this._set('prof-best-21',     fmtMs(d.best_time_21));
    this._set('prof-best-31',     fmtMs(d.best_time_31));
    this._set('prof-best-41',     fmtMs(d.best_time_41));
    this._set('prof-streak',      d.current_streak);
    this._set('prof-best-streak', d.best_streak);
    this._set('prof-powerups',    d.powerups_collected);
    this._set('prof-freezes',     d.freezes_used);
    this._set('prof-status',      '');
  }
}
