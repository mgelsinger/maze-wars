/**
 * MATCHMAKING — Public queue that pairs players by ELO proximity.
 * Ticks every 3 seconds. ELO range expands the longer a player waits.
 */

'use strict';

class MatchmakingManager {
  /**
   * @param {RoomManager} roomManager — used to create the room when a match is found
   */
  constructor(roomManager) {
    this._roomManager = roomManager;
    this._queue = new Map(); // socketId → { socket, playerName, elo, joinedAt }

    this._tickId = setInterval(() => this._tick(), 3000);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  add(socket, playerName, elo = 1000) {
    if (this._queue.has(socket.id)) return; // already in queue
    this._queue.set(socket.id, {
      socket,
      playerName,
      elo:      Math.max(600, elo),
      joinedAt: Date.now(),
    });
    socket.emit('matchmaking-status', {
      searching: true,
      inQueue:   this._queue.size,
    });
  }

  remove(socketId) {
    return this._queue.delete(socketId);
  }

  destroy() {
    clearInterval(this._tickId);
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  _tick() {
    if (this._queue.size < 2) return;

    // Sort oldest-first so long-waiters get priority
    const entries = Array.from(this._queue.values())
      .sort((a, b) => a.joinedAt - b.joinedAt);

    const matched = new Set();

    for (let i = 0; i < entries.length; i++) {
      const a = entries[i];
      if (matched.has(a.socket.id)) continue;

      const waitMs = Date.now() - a.joinedAt;
      // ELO window expands: 0-10s → ±200, 10-30s → ±400, 30s+ → any
      const range = waitMs < 10000 ? 200 : waitMs < 30000 ? 400 : Infinity;

      for (let j = i + 1; j < entries.length; j++) {
        const b = entries[j];
        if (matched.has(b.socket.id)) continue;

        if (Math.abs(a.elo - b.elo) <= range) {
          matched.add(a.socket.id);
          matched.add(b.socket.id);
          this._createMatch(a, b);
          break;
        }
      }
    }

    for (const id of matched) this._queue.delete(id);
  }

  _createMatch(a, b) {
    try {
      this._roomManager.createMatchmadeRoom(a, b);
    } catch (err) {
      console.error('[matchmaking] createMatch error:', err.message);
      // Put them back in queue so they can try again
      this._queue.set(a.socket.id, { ...a, joinedAt: Date.now() });
      this._queue.set(b.socket.id, { ...b, joinedAt: Date.now() });
    }
  }
}

module.exports = { MatchmakingManager };
