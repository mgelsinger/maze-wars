/**
 * POWERUPS — server-side registry and effect logic.
 * POWERUP_REGISTRY is the single source of truth for powerup definitions.
 * applyEffect / tickEffects are used by game-room.js.
 */

'use strict';

const POWERUP_REGISTRY = {
  speed_boost: {
    duration:   5000,   // ms
    rarity:     'common',
    color:      '#00CCFF',
    label:      'SPEED',
    icon:       '⚡',
  },
  freeze: {
    duration:   3000,   // ms
    rarity:     'rare',
    color:      '#AADDFF',
    label:      'FREEZE',
    icon:       '❄',
  },
};

/**
 * Apply a powerup effect to the using player (speed_boost)
 * or to a target player (freeze).
 */
function applyEffect(player, type, targetPlayer = null) {
  const def = POWERUP_REGISTRY[type];
  if (!def) return;

  switch (type) {
    case 'speed_boost':
      player.effects.speed_boost = def.duration;
      player.moveSpeed = 90;
      break;

    case 'freeze':
      if (targetPlayer) {
        // Counterplay: target holding speed_boost reduces freeze to 1.5 s
        const duration = (targetPlayer.effects.speed_boost > 0) ? 1500 : def.duration;
        targetPlayer.effects.freeze = duration;
      }
      break;
  }
}

/**
 * Tick down effect timers for one player by dtMs milliseconds.
 * Returns array of effect names that just expired this tick.
 */
function tickEffects(player, dtMs) {
  const expired = [];

  if (player.effects.speed_boost > 0) {
    player.effects.speed_boost -= dtMs;
    if (player.effects.speed_boost <= 0) {
      player.effects.speed_boost = 0;
      player.moveSpeed = 150;       // restore base speed
      expired.push('speed_boost');
    }
  }

  if (player.effects.freeze > 0) {
    player.effects.freeze -= dtMs;
    if (player.effects.freeze <= 0) {
      player.effects.freeze = 0;
      expired.push('freeze');
    }
  }

  return expired;
}

module.exports = { POWERUP_REGISTRY, applyEffect, tickEffects };
