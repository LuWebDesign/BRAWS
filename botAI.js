/**
 * botAI.js
 *
 * Controlador de bots IA para completar salas con pocos jugadores reales.
 * 
 * Comportamiento por estado:
 *   HUNT   → perseguir al jugador más cercano
 *   FLEE   → alejarse si estamos siendo empujados hacia el borde
 *   GRAB   → moverse hacia el power-up más cercano
 *   DODGE  → evadir si alguien viene con mucha velocidad hacia nosotros
 *
 * El bot toma decisiones cada DECISION_INTERVAL ms para simular
 * tiempo de reacción humano y no parecer un aimbot perfecto.
 */

const DECISION_INTERVAL = 180;   // ms entre re-evaluaciones de estado
const DANGER_BORDER_DIST = 80;   // px del borde para considerar "peligro"
const POWERUP_ATTRACT_DIST = 200;// px máximo para ir a buscar un power-up
const DASH_RANGE = 120;          // px al objetivo para usar especial
const BOT_NAMES = [
  'APEX-7', 'NULLBOT', 'VORTEX', 'GLITCH', 'NEMESIS',
  'CRYPT0', 'PHANTOM', 'NEXUS', 'CIPHER', 'OVERDRIVE'
];
const BOT_COLORS = ['#ff4444','#ff8800','#aaaaff','#ff44aa','#88ff44'];
const ARENA_RADIUS = 380;

// Dificultad: 0 (fácil) a 1 (difícil)
const DIFFICULTY = 0.72;

class BotAI {
  constructor(id, gameRoom) {
    this.id       = id;           // socket-like id del bot
    this.gameRoom = gameRoom;
    this.state    = 'HUNT';       // HUNT | FLEE | GRAB | DODGE
    this.targetId = null;         // jugador objetivo actual
    this.lastDecision = 0;
    this.noise    = Math.random() * Math.PI * 2; // ruido de movimiento

    // Input actual (como si fuera un jugador real)
    this.input = { dx: 0, dy: 0, action: false };
  }

  /**
   * Llamado cada tick del game loop.
   * Retorna el input que el bot "enviaría".
   */
  tick(now) {
    const me = this.gameRoom.players.get(this.id);
    if (!me || !me.alive) return { dx: 0, dy: 0, action: false };

    // Re-evaluar estado cada DECISION_INTERVAL ms
    if (now - this.lastDecision > DECISION_INTERVAL) {
      this._evaluate(me, now);
      this.lastDecision = now;
    }

    return this._executeState(me, now);
  }

  // ─── Evaluación de estado ─────────────────────────────────────────────────

  _evaluate(me, now) {
    const players = Array.from(this.gameRoom.players.values());
    const alive   = players.filter(p => p.alive && p.id !== this.id);
    const powerUps= this.gameRoom.powerUps;

    const distToCenter = Math.sqrt(me.x * me.x + me.y * me.y);
    const inDanger = distToCenter > ARENA_RADIUS - DANGER_BORDER_DIST;

    // Prioridad 1: FLEE si estamos cerca del borde con velocidad hacia afuera
    if (inDanger) {
      const velToCenter = -(me.vx * me.x + me.vy * me.y) / (distToCenter || 1);
      if (velToCenter < -60) {   // moviéndonos hacia fuera
        this.state = 'FLEE';
        return;
      }
    }

    // Prioridad 2: DODGE si alguien viene rápido hacia nosotros
    for (const p of alive) {
      const dx = me.x - p.x;
      const dy = me.y - p.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < 160) {
        // Velocidad del enemigo en nuestra dirección
        const approach = -(p.vx * dx + p.vy * dy) / (dist || 1);
        if (approach > 200 && Math.random() < DIFFICULTY) {
          this.state = 'DODGE';
          this.targetId = p.id;
          return;
        }
      }
    }

    // Prioridad 3: GRAB si hay power-up cercano y sin escudo propio
    if (!me.activeEffects.shield && powerUps.length > 0) {
      const nearest = powerUps.reduce((best, pu) => {
        const d = Math.sqrt((me.x-pu.x)**2 + (me.y-pu.y)**2);
        return d < best.d ? { pu, d } : best;
      }, { d: Infinity });

      if (nearest.d < POWERUP_ATTRACT_DIST && Math.random() < DIFFICULTY * 0.6) {
        this.state = 'GRAB';
        this._grabTarget = nearest.pu;
        return;
      }
    }

    // Default: HUNT al jugador más cercano (o el más débil)
    if (alive.length > 0) {
      // Mezcla de más cercano y el que está más cerca del borde
      const target = alive.reduce((best, p) => {
        const dx = me.x - p.x, dy = me.y - p.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const borderScore = Math.sqrt(p.x*p.x + p.y*p.y); // más cerca del borde = más atractivo
        const score = dist * 0.6 - borderScore * 0.4;
        return score < best.score ? { p, score } : best;
      }, { score: Infinity });

      this.state = 'HUNT';
      this.targetId = target.p?.id || null;
    }
  }

  // ─── Ejecución de estado ──────────────────────────────────────────────────

  _executeState(me, now) {
    let dx = 0, dy = 0, action = false;

    // Ruido oscilante para movimiento más orgánico
    this.noise += 0.04;
    const noiseFactor = (1 - DIFFICULTY) * 0.35;
    const noiseX = Math.sin(this.noise * 1.3) * noiseFactor;
    const noiseY = Math.cos(this.noise * 0.9) * noiseFactor;

    switch (this.state) {
      case 'HUNT': {
        const target = this.gameRoom.players.get(this.targetId);
        if (target?.alive) {
          const dir = this._dirTo(me, target);
          dx = dir.x + noiseX;
          dy = dir.y + noiseY;

          // Usar especial si está en rango
          const dist = Math.sqrt((me.x-target.x)**2 + (me.y-target.y)**2);
          if (dist < DASH_RANGE && me.specialCooldown <= now && Math.random() < DIFFICULTY * 0.8) {
            action = true;
          }
        }
        break;
      }

      case 'FLEE': {
        // Moverse hacia el centro
        const len = Math.sqrt(me.x*me.x + me.y*me.y) || 1;
        dx = -me.x / len + noiseX;
        dy = -me.y / len + noiseY;
        break;
      }

      case 'GRAB': {
        const pu = this._grabTarget;
        if (pu && this.gameRoom.powerUps.find(p => p.id === pu.id)) {
          const dir = this._dirTo(me, pu);
          dx = dir.x;
          dy = dir.y;
        } else {
          this.state = 'HUNT'; // power-up ya recogido
        }
        break;
      }

      case 'DODGE': {
        const threat = this.gameRoom.players.get(this.targetId);
        if (threat?.alive) {
          // Moverse perpendicular + hacia el centro
          const dir = this._dirTo(me, threat);
          dx = -dir.y * 0.7 - dir.x * 0.3 + noiseX; // perpendicular
          dy =  dir.x * 0.7 - dir.y * 0.3 + noiseY;

          // Alejarse del borde también
          const distC = Math.sqrt(me.x*me.x + me.y*me.y);
          if (distC > ARENA_RADIUS - 120) {
            dx -= me.x / distC * 0.5;
            dy -= me.y / distC * 0.5;
          }
        }
        break;
      }
    }

    // Normalizar
    const mag = Math.sqrt(dx*dx + dy*dy);
    if (mag > 1) { dx /= mag; dy /= mag; }

    return { dx, dy, action };
  }

  _dirTo(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    return { x: dx/len, y: dy/len };
  }

  // ─── Factory ──────────────────────────────────────────────────────────────

  static createBotPlayer(gameRoom, index = 0) {
    const id    = `bot_${Date.now()}_${index}`;
    const name  = BOT_NAMES[index % BOT_NAMES.length];
    const color = BOT_COLORS[index % BOT_COLORS.length];
    const classes = ['scout','tank','runner','brawler'];
    const cls   = classes[Math.floor(Math.random() * classes.length)];

    // Crear un socket-fake mínimo (no tiene emit real, el bot no necesita recibir)
    const fakeSocket = { id, emit: () => {} };

    gameRoom.addPlayer(fakeSocket, {
      nickname: `[BOT] ${name}`,
      skin: { botClass: cls, color }
    });

    return new BotAI(id, gameRoom);
  }
}

module.exports = { BotAI };
