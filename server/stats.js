/**
 * STATS — Player registration, match recording, ELO, and leaderboard queries.
 * All queries use better-sqlite3 (synchronous).
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./db');

// ─── ELO ─────────────────────────────────────────────────────────────────────

const ELO_K = 32;

function calcEloChange(playerElo, opponentElo, won) {
  const expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  return Math.round(ELO_K * ((won ? 1 : 0) - expected));
}

// ─── Player helpers ───────────────────────────────────────────────────────────

/**
 * Find or create a player by username. Returns { id, elo }.
 */
function getOrCreatePlayer(username, isBot = false) {
  const db  = getDb();
  const key = username.trim().toUpperCase().slice(0, 24) || 'GHOST';

  const existing = db.prepare('SELECT id, elo FROM players WHERE username = ?').get(key);
  if (existing) {
    if (isBot) db.prepare('UPDATE players SET is_bot = 1 WHERE id = ?').run(existing.id);
    return existing;
  }

  const id = uuidv4();
  db.prepare('INSERT INTO players (id, username, is_bot) VALUES (?, ?, ?)').run(id, key, isBot ? 1 : 0);
  db.prepare('INSERT INTO player_stats (player_id) VALUES (?)').run(id);
  return { id, elo: 1000 };
}

/**
 * Mark a player as an AI bot (external bot registration).
 */
function markAsBot(username) {
  const db  = getDb();
  const key = (username || '').trim().toUpperCase();
  db.prepare('UPDATE players SET is_bot = 1 WHERE username = ?').run(key);
}

/**
 * Look up a player's current ELO by username. Returns 1000 if unknown.
 */
function getPlayerElo(username) {
  const db  = getDb();
  const key = (username || '').trim().toUpperCase();
  const row = db.prepare('SELECT elo FROM players WHERE username = ?').get(key);
  return row ? row.elo : 1000;
}

// ─── Best-time column by maze width ──────────────────────────────────────────

function bestTimeCol(mazeWidth) {
  if (mazeWidth <= 15) return 'best_time_15';
  if (mazeWidth <= 21) return 'best_time_21';
  if (mazeWidth <= 31) return 'best_time_31';
  return 'best_time_41';
}

function mazeWidthForLevel(level) {
  if (level <= 3)  return 15;
  if (level <= 6)  return 21;
  if (level <= 9)  return 31;
  return 41;
}

// ─── Solo run recording ───────────────────────────────────────────────────────

/**
 * Record a solo maze completion.
 * Returns { newBestTime: bool, bestTime: ms, elo }.
 */
function recordSoloRun(username, level, timeMs, { powerupsCollected = 0, freezesUsed = 0 } = {}) {
  const db     = getDb();
  const player = getOrCreatePlayer(username);
  const col    = bestTimeCol(mazeWidthForLevel(level));

  const stats  = db.prepare('SELECT * FROM player_stats WHERE player_id = ?').get(player.id);
  const prevBest = stats[col];
  const newBest  = prevBest == null || timeMs < prevBest;

  db.prepare(`
    UPDATE player_stats SET
      games_played       = games_played + 1,
      total_time_ms      = total_time_ms + ?,
      ${col}             = CASE WHEN ${col} IS NULL OR ? < ${col} THEN ? ELSE ${col} END,
      powerups_collected = powerups_collected + ?,
      freezes_used       = freezes_used + ?
    WHERE player_id = ?
  `).run(timeMs, timeMs, timeMs, powerupsCollected, freezesUsed, player.id);

  return { newBestTime: newBest, bestTime: newBest ? timeMs : prevBest, elo: player.elo };
}

// ─── VS match recording ───────────────────────────────────────────────────────

/**
 * Record a 1v1 match. Updates ELO and stats for both players.
 * Returns { eloChanges: { [playerId]: delta } }.
 */
function recordVSMatch(p1Name, p2Name, winnerId_arg, level, p1TimeMs, p2TimeMs, p1Stats = {}, p2Stats = {}) {
  const db  = getDb();
  const p1  = getOrCreatePlayer(p1Name);
  const p2  = getOrCreatePlayer(p2Name);
  const p1Won = p1.id === winnerId_arg || p1Name.trim().toUpperCase() === winnerId_arg;
  const p2Won = !p1Won;

  // ELO deltas
  const d1 = calcEloChange(p1.elo, p2.elo, p1Won);
  const d2 = calcEloChange(p2.elo, p1.elo, p2Won);

  const newElo1 = Math.max(600, p1.elo + d1);
  const newElo2 = Math.max(600, p2.elo + d2);

  const mazeW = mazeWidthForLevel(level);
  const col   = bestTimeCol(mazeW);

  // Transaction for atomicity
  const updateMatch = db.transaction(() => {
    const matchId = uuidv4();

    db.prepare(`
      INSERT INTO matches (id, player1_id, player2_id, winner_id, maze_size, level,
                           p1_time_ms, p2_time_ms, p1_powerups, p2_powerups,
                           p1_freezes, p2_freezes, match_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'room')
    `).run(
      matchId, p1.id, p2.id, p1Won ? p1.id : p2.id, mazeW, level,
      p1TimeMs ?? null, p2TimeMs ?? null,
      p1Stats.powerupsCollected ?? 0, p2Stats.powerupsCollected ?? 0,
      p1Stats.freezesUsed       ?? 0, p2Stats.freezesUsed       ?? 0,
    );

    // Update player 1
    db.prepare(`UPDATE players SET elo = ? WHERE id = ?`).run(newElo1, p1.id);
    db.prepare(`
      UPDATE player_stats SET
        games_played       = games_played + 1,
        games_won          = games_won + ?,
        total_time_ms      = total_time_ms + ?,
        ${col}             = CASE WHEN ? IS NOT NULL AND (${col} IS NULL OR ? < ${col}) THEN ? ELSE ${col} END,
        powerups_collected = powerups_collected + ?,
        freezes_used       = freezes_used + ?,
        current_streak     = CASE WHEN ? THEN current_streak + 1 ELSE 0 END,
        best_streak        = CASE WHEN ? AND current_streak + 1 > best_streak THEN current_streak + 1 ELSE best_streak END
      WHERE player_id = ?
    `).run(
      p1Won ? 1 : 0,
      p1TimeMs ?? 0,
      p1TimeMs, p1TimeMs, p1TimeMs,
      p1Stats.powerupsCollected ?? 0,
      p1Stats.freezesUsed       ?? 0,
      p1Won ? 1 : 0,
      p1Won ? 1 : 0,
      p1.id,
    );

    // Update player 2
    db.prepare(`UPDATE players SET elo = ? WHERE id = ?`).run(newElo2, p2.id);
    db.prepare(`
      UPDATE player_stats SET
        games_played       = games_played + 1,
        games_won          = games_won + ?,
        total_time_ms      = total_time_ms + ?,
        ${col}             = CASE WHEN ? IS NOT NULL AND (${col} IS NULL OR ? < ${col}) THEN ? ELSE ${col} END,
        powerups_collected = powerups_collected + ?,
        freezes_used       = freezes_used + ?,
        current_streak     = CASE WHEN ? THEN current_streak + 1 ELSE 0 END,
        best_streak        = CASE WHEN ? AND current_streak + 1 > best_streak THEN current_streak + 1 ELSE best_streak END
      WHERE player_id = ?
    `).run(
      p2Won ? 1 : 0,
      p2TimeMs ?? 0,
      p2TimeMs, p2TimeMs, p2TimeMs,
      p2Stats.powerupsCollected ?? 0,
      p2Stats.freezesUsed       ?? 0,
      p2Won ? 1 : 0,
      p2Won ? 1 : 0,
      p2.id,
    );
  });

  updateMatch();

  return {
    eloChanges: { [p1.id]: d1, [p2.id]: d2 },
    newElos:    { [p1.id]: newElo1, [p2.id]: newElo2 },
    playerIds:  { p1: p1.id, p2: p2.id },
  };
}

// ─── Leaderboard queries ──────────────────────────────────────────────────────

/**
 * type: 'elo' | 'fastest_15' | 'fastest_21' | 'fastest_31' | 'fastest_41' | 'streak'
 */
function getLeaderboard(type, limit = 50) {
  const db = getDb();

  const queries = {
    elo: `
      SELECT p.username, p.elo AS value, s.games_played, s.games_won
      FROM players p JOIN player_stats s ON s.player_id = p.id
      WHERE p.is_bot = 0 AND s.games_played > 0
      ORDER BY p.elo DESC LIMIT ?`,

    fastest_15: `
      SELECT p.username, s.best_time_15 AS value, s.games_played, s.games_won
      FROM players p JOIN player_stats s ON s.player_id = p.id
      WHERE p.is_bot = 0 AND s.best_time_15 IS NOT NULL
      ORDER BY s.best_time_15 ASC LIMIT ?`,

    fastest_21: `
      SELECT p.username, s.best_time_21 AS value, s.games_played, s.games_won
      FROM players p JOIN player_stats s ON s.player_id = p.id
      WHERE p.is_bot = 0 AND s.best_time_21 IS NOT NULL
      ORDER BY s.best_time_21 ASC LIMIT ?`,

    fastest_31: `
      SELECT p.username, s.best_time_31 AS value, s.games_played, s.games_won
      FROM players p JOIN player_stats s ON s.player_id = p.id
      WHERE p.is_bot = 0 AND s.best_time_31 IS NOT NULL
      ORDER BY s.best_time_31 ASC LIMIT ?`,

    fastest_41: `
      SELECT p.username, s.best_time_41 AS value, s.games_played, s.games_won
      FROM players p JOIN player_stats s ON s.player_id = p.id
      WHERE p.is_bot = 0 AND s.best_time_41 IS NOT NULL
      ORDER BY s.best_time_41 ASC LIMIT ?`,

    streak: `
      SELECT p.username, s.best_streak AS value, s.games_played, s.games_won
      FROM players p JOIN player_stats s ON s.player_id = p.id
      WHERE p.is_bot = 0 AND s.best_streak > 0
      ORDER BY s.best_streak DESC LIMIT ?`,

    bots: `
      SELECT p.username, p.elo AS value, s.games_played, s.games_won
      FROM players p JOIN player_stats s ON s.player_id = p.id
      WHERE p.is_bot = 1
      ORDER BY p.elo DESC LIMIT ?`,
  };

  const sql = queries[type];
  if (!sql) return [];
  return db.prepare(sql).all(limit);
}

// ─── Profile ─────────────────────────────────────────────────────────────────

function getProfile(username) {
  const db  = getDb();
  const key = (username || '').trim().toUpperCase();
  const row = db.prepare(`
    SELECT p.username, p.elo, p.created_at,
           s.games_played, s.games_won,
           s.best_time_15, s.best_time_21, s.best_time_31, s.best_time_41,
           s.powerups_collected, s.freezes_used, s.times_frozen,
           s.current_streak, s.best_streak
    FROM players p JOIN player_stats s ON s.player_id = p.id
    WHERE p.username = ?
  `).get(key);
  return row || null;
}

module.exports = { getOrCreatePlayer, getPlayerElo, markAsBot, recordSoloRun, recordVSMatch, getLeaderboard, getProfile };
