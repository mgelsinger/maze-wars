/**
 * EXTERNAL AI BOT API HELPERS
 * External bots connect via standard Socket.IO to the main namespace.
 * Identify themselves with handshake auth: { botName: 'MyBot', apiKey: '...' }
 * They then send the same events as human players (find-match, join-room, player-input, etc.)
 * and receive the same events (game-start, game-state, game-over, etc.).
 *
 * API_OPEN=false env var enables apiKey enforcement (for production use).
 */

'use strict';

const OPEN_ACCESS = (process.env.AI_API_OPEN !== 'false'); // open by default for dev

function isExternalBot(socket) {
  return !!(socket.handshake.auth?.botName);
}

function getBotName(socket) {
  return ((socket.handshake.auth?.botName) || '')
    .slice(0, 24)
    .toUpperCase()
    .replace(/[^A-Z0-9_\-]/g, '') || 'UNNAMED_BOT';
}

function validateAuth(socket) {
  if (OPEN_ACCESS) return true;
  const key = socket.handshake.auth?.apiKey || '';
  return key.length >= 8; // minimal validation — extend for production
}

module.exports = { isExternalBot, getBotName, validateAuth };
