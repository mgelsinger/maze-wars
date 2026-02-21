/**
 * NETWORK MANAGER
 * Thin wrapper around Socket.IO client.
 * `io` global is injected by /socket.io/socket.io.js script tag.
 */

export class NetworkManager {
  constructor() {
    this._socket      = null;
    this._handlers    = new Map();
    this._connected   = false;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  connect() {
    if (this._socket) return; // already connected

    // io() is the Socket.IO global loaded via <script> tag
    this._socket = window.io({
      autoConnect:         true,
      reconnection:        true,
      reconnectionAttempts: 5,
      reconnectionDelay:   1000,
    });

    this._socket.onAny((event, data) => {
      const handlers = this._handlers.get(event);
      if (handlers) handlers.forEach(h => h(data));
    });

    this._socket.on('connect', () => {
      this._connected = true;
      this._fire('_connected', {});
    });

    this._socket.on('disconnect', reason => {
      this._connected = false;
      this._fire('_disconnected', { reason });
    });

    this._socket.on('connect_error', err => {
      this._fire('_error', { message: err.message });
    });
  }

  disconnect() {
    if (this._socket) {
      this._socket.disconnect();
      this._socket    = null;
      this._connected = false;
    }
  }

  get isConnected() { return this._connected; }
  get socketId()    { return this._socket?.id; }

  // ── Event Bus ────────────────────────────────────────────────────────────────

  on(event, handler) {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event).push(handler);
    return () => this.off(event, handler); // returns unsubscribe fn
  }

  off(event, handler) {
    const list = this._handlers.get(event);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  }

  offEvent(event) {
    this._handlers.delete(event);
  }

  _fire(event, data) {
    const handlers = this._handlers.get(event);
    if (handlers) handlers.forEach(h => h(data));
  }

  // ── Emit ────────────────────────────────────────────────────────────────────

  emit(event, data) {
    if (!this._socket?.connected) {
      console.warn('[network] not connected, dropping:', event);
      return;
    }
    this._socket.emit(event, data);
  }

  // ── Game Actions ─────────────────────────────────────────────────────────────

  createRoom(playerName, level = 1) {
    this.emit('create-room', { playerName, level });
  }

  joinRoom(roomCode, playerName) {
    this.emit('join-room', { roomCode: (roomCode || '').toUpperCase().trim(), playerName });
  }

  sendReady() {
    this.emit('player-ready', {});
  }

  sendInput(direction, seq) {
    this.emit('player-input', { direction, seq });
  }

  sendUsePowerup(powerupType) {
    this.emit('use-powerup', { powerupType });
  }

  sendRematch() {
    this.emit('rematch', {});
  }

  leaveRoom() {
    this.emit('leave-room', {});
  }
}

export const network = new NetworkManager();
