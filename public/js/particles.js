/**
 * PARTICLE SYSTEM
 * Handles all particle effects: trails, collection bursts, win explosions.
 */

export class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  // Player movement trail
  addTrail(worldX, worldY, color) {
    this.particles.push({
      type:    'trail',
      x:       worldX,
      y:       worldY,
      vx:      (Math.random() - 0.5) * 0.5,
      vy:      (Math.random() - 0.5) * 0.5,
      life:    1.0,
      decay:   0.02 + Math.random() * 0.02,
      radius:  2 + Math.random() * 3,
      color,
    });
  }

  // Powerup collection burst
  addBurst(worldX, worldY, color, count = 16) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const speed = 1.5 + Math.random() * 3;
      this.particles.push({
        type:   'burst',
        x:      worldX,
        y:      worldY,
        vx:     Math.cos(angle) * speed,
        vy:     Math.sin(angle) * speed,
        life:   1.0,
        decay:  0.025 + Math.random() * 0.025,
        radius: 2 + Math.random() * 3,
        color,
      });
    }
  }

  // Ice/freeze hit
  addFreezeHit(worldX, worldY) {
    const colors = ['#aaddff', '#ffffff', '#88ccff'];
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 4;
      const color = colors[Math.floor(Math.random() * colors.length)];
      this.particles.push({
        type:   'freeze',
        x:      worldX,
        y:      worldY,
        vx:     Math.cos(angle) * speed,
        vy:     Math.sin(angle) * speed,
        life:   1.0,
        decay:  0.015 + Math.random() * 0.02,
        radius: 1 + Math.random() * 4,
        color,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.2,
      });
    }
  }

  // Win celebration explosion
  addWin(worldX, worldY) {
    const colors = ['#39ff14', '#00fff5', '#ffd700', '#ff00aa'];
    for (let i = 0; i < 60; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 6;
      const color = colors[Math.floor(Math.random() * colors.length)];
      this.particles.push({
        type:   'burst',
        x:      worldX,
        y:      worldY,
        vx:     Math.cos(angle) * speed,
        vy:     Math.sin(angle) * speed,
        life:   1.0,
        decay:  0.008 + Math.random() * 0.015,
        radius: 2 + Math.random() * 5,
        color,
      });
    }
  }

  // Speed boost stream
  addSpeedStream(worldX, worldY, color) {
    if (Math.random() > 0.4) return; // sparse
    this.particles.push({
      type:   'stream',
      x:      worldX + (Math.random() - 0.5) * 8,
      y:      worldY + (Math.random() - 0.5) * 8,
      vx:     (Math.random() - 0.5) * 1,
      vy:     (Math.random() - 0.5) * 1,
      life:   1.0,
      decay:  0.04 + Math.random() * 0.04,
      radius: 1 + Math.random() * 2,
      color,
    });
  }

  update() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x    += p.vx;
      p.y    += p.vy;
      p.life -= p.decay;
      p.vx   *= 0.95;
      p.vy   *= 0.95;

      if (p.rotation !== undefined) {
        p.rotation += p.rotSpeed;
      }

      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  draw(ctx) {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);

      if (p.type === 'freeze' && p.rotation !== undefined) {
        // Draw snowflake-ish cross
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.strokeStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur  = 6;
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(-p.radius, 0); ctx.lineTo(p.radius, 0);
        ctx.moveTo(0, -p.radius); ctx.lineTo(0, p.radius);
        ctx.stroke();
      } else {
        // Glowing circle
        ctx.shadowColor = p.color;
        ctx.shadowBlur  = p.radius * 2;
        ctx.fillStyle   = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.radius * p.life), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  clear() {
    this.particles = [];
  }

  get count() { return this.particles.length; }
}
