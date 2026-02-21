/**
 * DATABASE — SQLite setup via better-sqlite3.
 * Call init() once at server startup. Use getDb() everywhere else.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH  = path.join(DATA_DIR, 'maze-wars.db');

let _db = null;

function init() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id          TEXT PRIMARY KEY,
      username    TEXT UNIQUE NOT NULL COLLATE NOCASE,
      elo         INTEGER NOT NULL DEFAULT 1000,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS player_stats (
      player_id          TEXT    PRIMARY KEY,
      games_played       INTEGER NOT NULL DEFAULT 0,
      games_won          INTEGER NOT NULL DEFAULT 0,
      total_time_ms      INTEGER NOT NULL DEFAULT 0,
      best_time_15       INTEGER,
      best_time_21       INTEGER,
      best_time_31       INTEGER,
      best_time_41       INTEGER,
      powerups_collected INTEGER NOT NULL DEFAULT 0,
      freezes_used       INTEGER NOT NULL DEFAULT 0,
      times_frozen       INTEGER NOT NULL DEFAULT 0,
      current_streak     INTEGER NOT NULL DEFAULT 0,
      best_streak        INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (player_id) REFERENCES players(id)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id          TEXT PRIMARY KEY,
      player1_id  TEXT,
      player2_id  TEXT,
      winner_id   TEXT,
      maze_size   INTEGER,
      level       INTEGER,
      p1_time_ms  INTEGER,
      p2_time_ms  INTEGER,
      p1_powerups INTEGER NOT NULL DEFAULT 0,
      p2_powerups INTEGER NOT NULL DEFAULT 0,
      p1_freezes  INTEGER NOT NULL DEFAULT 0,
      p2_freezes  INTEGER NOT NULL DEFAULT 0,
      match_type  TEXT    NOT NULL DEFAULT 'room',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_players_username ON players(username COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_matches_created  ON matches(created_at);
  `);

  // Phase 5 migration: add is_bot column if missing
  try { _db.exec(`ALTER TABLE players ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0`); } catch (_) {}

  console.log(`  [db] SQLite ready: ${DB_PATH}`);
  return _db;
}

function getDb() {
  if (!_db) throw new Error('[db] Not initialized — call init() first');
  return _db;
}

module.exports = { init, getDb };
