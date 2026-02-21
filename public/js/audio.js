/**
 * AUDIO MANAGER — Web Audio API synthesized sounds
 * No audio files required — all sounds generated programmatically.
 */

export class AudioManager {
  constructor() {
    this._ctx    = null;
    this._master = null;
    this._muted  = false;
    this._volume = 0.5;
  }

  _ensureCtx() {
    if (this._ctx) return;
    this._ctx    = new (window.AudioContext || window.webkitAudioContext)();
    this._master = this._ctx.createGain();
    this._master.gain.value = this._volume;
    this._master.connect(this._ctx.destination);
  }

  _resume() {
    if (this._ctx && this._ctx.state === 'suspended') {
      this._ctx.resume();
    }
  }

  // Call during a user-gesture event to unlock the AudioContext
  init() { this._ensureCtx(); this._resume(); }

  setMuted(muted)  { this._muted = muted; if (this._master) this._master.gain.value = muted ? 0 : this._volume; }
  setVolume(v)     { this._volume = v;    if (this._master && !this._muted) this._master.gain.value = v; }

  // --- Sound generators ---

  // Short click for movement
  playMove() {
    if (this._muted) return;
    this._ensureCtx(); this._resume();
    const ctx  = this._ctx;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(this._master);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.04);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.07);
  }

  // Wall bump
  playBump() {
    if (this._muted) return;
    this._ensureCtx(); this._resume();
    const ctx  = this._ctx;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(this._master);
    osc.type = 'square';
    osc.frequency.setValueAtTime(80, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.09);
  }

  // Ascending arpeggio for powerup collect
  playCollect() {
    if (this._muted) return;
    this._ensureCtx(); this._resume();
    const ctx    = this._ctx;
    const notes  = [523, 659, 784, 1047]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const t    = ctx.currentTime + i * 0.06;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(this._master);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc.start(t);
      osc.stop(t + 0.12);
    });
  }

  // Whoosh for speed boost
  playSpeedBoost() {
    if (this._muted) return;
    this._ensureCtx(); this._resume();
    const ctx    = this._ctx;
    const noise  = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain   = ctx.createGain();
    noise.connect(filter); filter.connect(gain); gain.connect(this._master);
    noise.type = 'sawtooth';
    noise.frequency.setValueAtTime(60, ctx.currentTime);
    noise.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.3);
    filter.type = 'bandpass';
    filter.frequency.value = 600;
    gain.gain.setValueAtTime(0.0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    noise.start(ctx.currentTime);
    noise.stop(ctx.currentTime + 0.45);
  }

  // Ice crack for freeze
  playFreeze() {
    if (this._muted) return;
    this._ensureCtx(); this._resume();
    const ctx    = this._ctx;
    const osc    = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain   = ctx.createGain();
    osc.connect(filter); filter.connect(gain); gain.connect(this._master);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.15);
    filter.type = 'highpass';
    filter.frequency.value = 800;
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
  }

  // 3-2-1 countdown beep
  playCountdown(final = false) {
    if (this._muted) return;
    this._ensureCtx(); this._resume();
    const ctx  = this._ctx;
    const freq = final ? 880 : 440;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(this._master);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
  }

  // GO! sound (ascending chord)
  playGo() {
    if (this._muted) return;
    this._ensureCtx(); this._resume();
    const ctx   = this._ctx;
    const freqs = [523, 659, 784]; // C E G major chord
    freqs.forEach(freq => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(this._master);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.45);
    });
  }

  // Victory fanfare
  playWin() {
    if (this._muted) return;
    this._ensureCtx(); this._resume();
    const ctx = this._ctx;
    // Ascending arpeggio + sustained chord
    const melody = [523, 659, 784, 1047, 784, 1047, 1319];
    melody.forEach((freq, i) => {
      const t    = ctx.currentTime + i * 0.09;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(this._master);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.start(t);
      osc.stop(t + 0.28);
    });
  }
}

export const audio = new AudioManager();
