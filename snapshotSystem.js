/**
 * SnapshotSystem
 *
 * Serializa el estado autoritativo de una sala para enviarlo al cliente.
 * No decide física ni reglas de gameplay.
 */

class SnapshotSystem {
  constructor({ specialCooldown }) {
    this.specialCooldown = specialCooldown;
  }

  create(room, now) {
    const players = [];

    for (const player of room.players.values()) {
      players.push({
        id: player.id,
        alive: player.alive,
        x: Math.round(player.x * 10) / 10,
        y: Math.round(player.y * 10) / 10,
        vx: Math.round(player.vx),
        vy: Math.round(player.vy),
        angle: Math.round(player.angle * 100) / 100,
        radius: Math.round(player.radius * 10) / 10,
        specialReady: player.specialCooldown <= now,
        specialCooldownPct: player.specialCooldown <= now
          ? 1
          : 1 - (player.specialCooldown - now) / this.specialCooldown,
        hasShield: !!(player.activeEffects.shield && player.activeEffects.shield > now),
        hasSpeed: !!(player.activeEffects.speed && player.activeEffects.speed > now),
        isBig: !!(player.activeEffects.big && player.activeEffects.big > now),
        invincible: player.invincibleUntil > now,
        inBoostZone: player.inBoostZone,
        lastProcessedInput: room.inputQueue.lastProcessedInput(player.id),
      });
    }

    return {
      t: now,
      tick: room.tickCount,
      players,
      powerUps: room.powerUps.map(powerUp => ({
        id: powerUp.id,
        x: powerUp.x,
        y: powerUp.y,
        type: powerUp.type,
        color: powerUp.color,
      })),
    };
  }
}

module.exports = { SnapshotSystem };
