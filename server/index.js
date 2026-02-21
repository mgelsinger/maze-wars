/**
 * MAZE WARS — Server Entry Point
 * Express + Socket.IO server with SQLite stats and matchmaking.
 * Phase 4: Database, ELO, leaderboards, matchmaking.
 */

'use strict';

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');

const db                         = require('./db');
const stats                      = require('./stats');
const { RoomManager, setStats }  = require('./game-room');
const { MatchmakingManager }     = require('./matchmaking');
const { isExternalBot, getBotName, validateAuth } = require('./ai-api');

const PORT       = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ─── Init DB ─────────────────────────────────────────────────────────────────
db.init();
setStats(stats); // inject stats into game-room module

// ─── Express ─────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  pingTimeout:  20000,
  pingInterval:  5000,
});

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ─── REST API ─────────────────────────────────────────────────────────────────

// Leaderboard — type: elo | fastest_15 | fastest_21 | fastest_31 | fastest_41 | streak
app.get('/api/leaderboards/:type', (req, res) => {
  const { type } = req.params;
  const limit    = Math.min(100, parseInt(req.query.limit, 10) || 50);
  try {
    res.json(stats.getLeaderboard(type, limit));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Player profile
app.get('/api/player/:username', (req, res) => {
  try {
    const profile = stats.getProfile(req.params.username);
    if (!profile) return res.status(404).json({ error: 'Player not found' });
    res.json(profile);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Register or fetch player (so client can get its DB id + ELO)
app.post('/api/register', (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });
  try {
    const player = stats.getOrCreatePlayer(username);
    res.json(player);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Register an external AI bot (creates player record with is_bot=1, returns apiKey hint)
app.post('/api/bots/register', (req, res) => {
  const { botName } = req.body || {};
  if (!botName) return res.status(400).json({ error: 'botName required' });
  try {
    const player = stats.getOrCreatePlayer(botName, true);
    res.json({ ...player, botName: botName.trim().toUpperCase().slice(0, 24) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Record solo run
app.post('/api/solo', (req, res) => {
  const { username, level, timeMs, powerupsCollected, freezesUsed } = req.body || {};
  if (!username || !timeMs) return res.status(400).json({ error: 'username and timeMs required' });
  try {
    const result = stats.recordSoloRun(username, level || 1, timeMs, { powerupsCollected, freezesUsed });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SPA fallback — must come AFTER /api routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ─── Socket.IO / Game Logic ──────────────────────────────────────────────────
const roomManager      = new RoomManager(io);
const matchmakingMgr   = new MatchmakingManager(roomManager);
roomManager.setMatchmaking(matchmakingMgr);

io.on('connection', socket => {
  // Detect external AI bots by handshake auth
  if (isExternalBot(socket)) {
    if (!validateAuth(socket)) {
      socket.emit('error', { message: 'Invalid API key' });
      socket.disconnect();
      return;
    }
    const botName = getBotName(socket);
    socket.data.isExternalBot = true;
    socket.data.botName       = botName;
    // Register bot in DB (idempotent)
    try { stats.getOrCreatePlayer(botName, true); } catch (_) {}
    console.log(`External bot connected: ${botName} (${socket.id})`);
  }
  roomManager.handleConnection(socket);
});

// ─── Start ───────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n  ╔═══════════════════════════════╗`);
  console.log(`  ║    MAZE WARS  —  Phase 4      ║`);
  console.log(`  ║  http://localhost:${PORT}         ║`);
  console.log(`  ╚═══════════════════════════════╝\n`);
});
