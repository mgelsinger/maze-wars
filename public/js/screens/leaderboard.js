/**
 * LEADERBOARD SCREEN
 * Tabbed leaderboard — fetches from /api/leaderboards/:type
 */

const TABS = [
  { key: 'elo',        label: 'HIGHEST ELO',  col: 'ELO',    fmt: v => v },
  { key: 'fastest_15', label: 'FASTEST 15×15', col: 'TIME',  fmt: fmtMs },
  { key: 'fastest_21', label: 'FASTEST 21×21', col: 'TIME',  fmt: fmtMs },
  { key: 'fastest_31', label: 'FASTEST 31×31', col: 'TIME',  fmt: fmtMs },
  { key: 'fastest_41', label: 'FASTEST 41×41', col: 'TIME',  fmt: fmtMs },
  { key: 'streak',     label: 'WIN STREAK',    col: 'STREAK', fmt: v => v },
  { key: 'bots',       label: 'AI BOTS',       col: 'ELO',    fmt: v => v },
];

function fmtMs(ms) {
  if (ms == null) return '--:--';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const c = ms % 1000;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(c).padStart(3,'0')}`;
}

export class LeaderboardScreen {
  constructor(app) {
    this._app      = app;
    this._el       = document.getElementById('screen-leaderboard');
    this._activeTab = 'elo';
    this._bindEvents();
  }

  show() {
    this._el.classList.add('active');
    this._renderTabs();
    this._loadTab(this._activeTab);
  }

  hide() {
    this._el.classList.remove('active');
  }

  _bindEvents() {
    document.getElementById('btn-lb-back')
      ?.addEventListener('click', () => this._app.navigate('menu'));
    document.getElementById('btn-lb-refresh')
      ?.addEventListener('click', () => this._loadTab(this._activeTab));
  }

  _renderTabs() {
    const container = document.getElementById('lb-tabs');
    if (!container) return;
    container.innerHTML = TABS.map(t => `
      <button class="lb-tab-btn${t.key === this._activeTab ? ' active' : ''}"
              data-tab="${t.key}">${t.label}</button>
    `).join('');
    container.querySelectorAll('.lb-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._activeTab = btn.dataset.tab;
        container.querySelectorAll('.lb-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._loadTab(this._activeTab);
      });
    });
  }

  _loadTab(type) {
    const tbody = document.getElementById('lb-tbody');
    const colEl = document.getElementById('lb-col-value');
    if (!tbody) return;

    const tab = TABS.find(t => t.key === type);
    if (tab && colEl) colEl.textContent = tab.col;

    tbody.innerHTML = '<tr><td colspan="4" class="lb-loading">LOADING...</td></tr>';

    fetch(`/api/leaderboards/${type}?limit=50`)
      .then(r => r.json())
      .then(rows => {
        if (!rows.length) {
          tbody.innerHTML = '<tr><td colspan="4" class="lb-empty">NO DATA YET — BE THE FIRST!</td></tr>';
          return;
        }
        const myName = this._app.getUsername();
        tbody.innerHTML = rows.map((row, i) => {
          const isMe = row.username.toUpperCase() === myName.toUpperCase();
          const winRate = row.games_played > 0
            ? Math.round((row.games_won / row.games_played) * 100) + '%'
            : '—';
          return `
            <tr class="${isMe ? 'lb-row-me' : ''}">
              <td class="lb-rank">${i + 1}</td>
              <td class="lb-name">${row.username}${isMe ? ' ◄' : ''}</td>
              <td class="lb-value">${tab ? tab.fmt(row.value) : row.value}</td>
              <td class="lb-games">${row.games_played} (${winRate})</td>
            </tr>
          `;
        }).join('');
      })
      .catch(() => {
        tbody.innerHTML = '<tr><td colspan="4" class="lb-empty">FAILED TO LOAD</td></tr>';
      });
  }
}
