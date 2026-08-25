/**
 * GameRoom.js
 *
 * Clase central que maneja:
 * - Estado de la sala (lobby → countdown → playing → finished)
 * - Loop de física autoritativo a 60 FPS
 * - Loop de snapshots de red a 20 FPS
 * - Física: movimiento, colisiones, obstáculos, boost zones, límites
 * - Killer tracking (ventana de 3s para acreditar eliminación)
 * - Power-ups y efectos temporales
 * - Bot IA integrada (rellena salas con < MIN_PLAYERS reales)
 * - Serialización de snapshots de red mediante SnapshotSystem
 * - Persistencia via db.js (graceful degradation si no hay SQLite)
 */

const { BotAI }             = require('./botAI');
const { saveMatchResult }   = require('./db');
const { SnapshotSystem } = require('./snapshotSystem');
const { InputQueue } = require('./inputQueue');

// ─── Constantes de física ─────────────────────────────────────────────────────
const TICK_RATE         = 60;
const TICK_MS           = 1000 / TICK_RATE;
const SNAPSHOT_RATE     = 20;
const SNAPSHOT_MS       = 1000 / SNAPSHOT_RATE;
const ARENA_RADIUS      = 380;
const PLAYER_RADIUS     = 22;
const PLAYER_SPEED      = 220;
const PUSH_FORCE        = 480;
const FRICTION          = 0.88;
const PUSH_FRICTION     = 0.92;
const SPECIAL_COOLDOWN  = 5000;
const RESPAWN_INVINCIBLE= 1500;
const KILLER_CREDIT_WINDOW = 3000;
const MIN_REAL_PLAYERS  = 1;   // mínimo de humanos para arrancar (bots completan)
const MAX_BOTS          = 3;

// ─── Power-ups ────────────────────────────────────────────────────────────────
const POWERUP_TYPES = [
  { type: 'speed',  color: '#00ff88', duration: 4000, label: '⚡ VELOCIDAD' },
  { type: 'shield', color: '#4488ff', duration: 5000, label: '🛡 ESCUDO'   },
  { type: 'big',    color: '#ff4444', duration: 3000, label: '💥 GIGANTE'  },
];

// ─── Clases de bot ────────────────────────────────────────────────────────────
const BOT_CLASSES = {
  scout:   { name:'Scout',   speedMult:1.4,  sizeMult:0.80, pushMult:0.8  },
  tank:    { name:'Tank',    speedMult:0.7,  sizeMult:1.35, pushMult:1.5  },
  runner:  { name:'Runner',  speedMult:1.2,  sizeMult:0.95, pushMult:0.9  },
  brawler: { name:'Brawler', speedMult:1.0,  sizeMult:1.00, pushMult:1.2  },
};

// ─── Mapas ────────────────────────────────────────────────────────────────────
const MAPS = {
  circle: {
    name: 'Arena Circular',
    obstacles: [],
    boostZones: [
      { x:  160, y:    0, radius: 30, factor: 1.55, color: '#00ffcc' },
      { x: -160, y:    0, radius: 30, factor: 1.55, color: '#00ffcc' },
      { x:    0, y:  160, radius: 30, factor: 1.55, color: '#00ffcc' },
      { x:    0, y: -160, radius: 30, factor: 1.55, color: '#00ffcc' },
    ]
  },
  pillars: {
    name: 'Pilares',
    obstacles: [
      { x:  0,   y:   0,  radius: 30 },
      { x:  150, y:  150, radius: 22 },
      { x: -150, y:  150, radius: 22 },
      { x:  150, y: -150, radius: 22 },
      { x: -150, y: -150, radius: 22 },
    ],
    boostZones: [
      { x:  260, y:  0,  radius: 25, factor: 1.6, color: '#ff8800' },
      { x: -260, y:  0,  radius: 25, factor: 1.6, color: '#ff8800' },
    ]
  },
  cross: {
    name: 'Cruz',
    obstacles: [
      { x:  220, y:   0, radius: 28 },
      { x: -220, y:   0, radius: 28 },
      { x:    0, y: 220, radius: 28 },
      { x:    0, y:-220, radius: 28 },
      { x:    0, y:   0, radius: 20 },
    ],
    boostZones: [
      { x:  130, y:  130, radius: 28, factor: 1.7, color: '#cc44ff' },
      { x: -130, y:  130, radius: 28, factor: 1.7, color: '#cc44ff' },
      { x:  130, y: -130, radius: 28, factor: 1.7, color: '#cc44ff' },
      { x: -130, y: -130, radius: 28, factor: 1.7, color: '#cc44ff' },
    ]
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const dist   = (a, b) => { const dx=a.x-b.x,dy=a.y-b.y; return Math.sqrt(dx*dx+dy*dy); };
const norm   = (dx,dy)=> { const l=Math.sqrt(dx*dx+dy*dy)||1; return {x:dx/l,y:dy/l}; };
const clamp  = (v,a,b)=> Math.max(a,Math.min(b,v));

// ─── Clase GameRoom ───────────────────────────────────────────────────────────
class GameRoom {
  constructor(id, { name, maxPlayers, isPrivate, hostId, hostName, io }) {
    this.id          = id;
    this.name        = name;
    this.maxPlayers  = maxPlayers;
    this.isPrivate   = isPrivate;
    this.hostId      = hostId;
    this.hostName    = hostName;
    this.io          = io;

    this.state       = 'lobby';
    this.players     = new Map();   // id → playerState  (humanos + bots)
    this.inputs      = new Map();   // id → último input aplicado
    this.inputQueue  = new InputQueue();
    this.powerUps    = [];
    this.bots        = [];          // instancias BotAI activas
    this.chatHistory = [];

    // Mapa aleatorio
    const keys    = Object.keys(MAPS);
    this.mapKey   = keys[Math.floor(Math.random() * keys.length)];
    this.map      = MAPS[this.mapKey];

    // Timers
    this.gameLoop      = null;
    this.snapshotLoop  = null;
    this.countdownTimer= null;
    this.powerUpTimer  = null;

    // Stats de partida
    this.tickCount = 0;
    this.startTime = 0;

    this.snapshotSystem = new SnapshotSystem({ specialCooldown: SPECIAL_COOLDOWN });

    // Rate limiting de inputs: último timestamp de input por jugador
    this._inputTimestamps = new Map();

    // Input spam detection: conteo de inputs sospechosos
    this._inputWarnings = new Map();
  }

  // ─── Jugadores ─────────────────────────────────────────────────────────────

  addPlayer(socket, { nickname, skin }) {
    const cls       = BOT_CLASSES[skin?.botClass] || BOT_CLASSES.brawler;
    const count     = this.players.size;
    const spawnAngle= (count / Math.max(this.maxPlayers, 2)) * Math.PI * 2;
    const spawnDist = ARENA_RADIUS * 0.55;

    this.players.set(socket.id, {
      id:       socket.id,
      nickname: (nickname || 'Bot').slice(0, 16),
      color:    skin?.color || '#cc44ff',
      botClass: skin?.botClass || 'brawler',
      isBot:    socket.id.startsWith('bot_'),

      // Física
      x: Math.cos(spawnAngle) * spawnDist,
      y: Math.sin(spawnAngle) * spawnDist,
      vx: 0, vy: 0,
      angle: Math.atan2(-Math.sin(spawnAngle), -Math.cos(spawnAngle)),

      // Stats por clase
      radius:   PLAYER_RADIUS * cls.sizeMult,
      speed:    PLAYER_SPEED  * cls.speedMult,
      pushMult: cls.pushMult,

      // Estado
      alive:          true,
      invincibleUntil:0,
      specialCooldown:0,
      activeEffects:  {},
      inBoostZone:    false,

      // Partida
      eliminations: 0,
      pushCount:    0,
      lastHitBy:    null,
      lastHitTime:  0,
    });

    this.inputs.set(socket.id, { dx:0, dy:0, action:false });
    this.inputQueue.addPlayer(socket.id);
    this._inputTimestamps.set(socket.id, 0);
    this._inputWarnings.set(socket.id, 0);
  }

  removePlayer(id) {
    this.players.delete(id);
    this.inputs.delete(id);
    this.inputQueue.removePlayer(id);
    this._inputTimestamps.delete(id);
    this._inputWarnings.delete(id);

    // Remover bot asociado si lo hay
    const bi = this.bots.findIndex(b => b.id === id);
    if (bi !== -1) this.bots.splice(bi, 1);

    if (this.state === 'playing') this.checkWinCondition();
  }

  // ─── Bots IA ───────────────────────────────────────────────────────────────

  /** Añadir bots hasta llegar a minPlayers jugadores totales */
  _fillWithBots(minPlayers) {
    const realCount = Array.from(this.players.values()).filter(p => !p.isBot).length;
    const total     = this.players.size;
    const needed    = Math.min(minPlayers - total, MAX_BOTS);
    for (let i = 0; i < needed; i++) {
      const bot = BotAI.createBotPlayer(this, i);
      this.bots.push(bot);
    }
    console.log(`[BOTS] ${this.bots.length} bots añadidos a sala ${this.id}`);
  }

  // ─── Countdown ─────────────────────────────────────────────────────────────

  startCountdown() {
    // Rellenar con bots si hay menos de 2 jugadores
    if (this.players.size < 2) this._fillWithBots(2);

    this.state = 'countdown';
    let count  = 3;
    this.io.to(this.id).emit('countdown', { count });

    this.countdownTimer = setInterval(() => {
      count--;
      if (count > 0) {
        this.io.to(this.id).emit('countdown', { count });
      } else {
        clearInterval(this.countdownTimer);
        this.startGame();
      }
    }, 1000);
  }

  startGame() {
    this.state     = 'playing';
    this.startTime = Date.now();
    this.powerUps  = [];
    this.tickCount = 0;

    const now = Date.now();
    for (const p of this.players.values()) {
      p.alive          = true;
      p.invincibleUntil= now + RESPAWN_INVINCIBLE;
      p.activeEffects  = {};
      p.eliminations   = 0;
      p.pushCount      = 0;
    }

    this.io.to(this.id).emit('game_started', {
      players:     this.getPlayersState(),
      arenaRadius: ARENA_RADIUS,
      map: { key: this.mapKey, name: this.map.name, obstacles: this.map.obstacles, boostZones: this.map.boostZones }
    });

    this.powerUpTimer = setInterval(() => this.spawnPowerUp(), 8000);
    this.gameLoop     = setInterval(() => this.tick(), TICK_MS);
    this.snapshotLoop = setInterval(() => this.broadcastState(Date.now()), SNAPSHOT_MS);

    console.log(`[GAME] Partida iniciada en ${this.id} (${this.players.size} jugadores, mapa: ${this.mapKey}; física: ${TICK_RATE}Hz, snapshots: ${SNAPSHOT_RATE}Hz)`);
  }

  // ─── Game Loop ─────────────────────────────────────────────────────────────

  tick() {
    const dt  = TICK_MS / 1000;
    const now = Date.now();
    this.tickCount++;

    // 0. Bots toman decisiones y escriben su input
    for (const bot of this.bots) {
      const input = bot.tick(now);
      this.inputs.set(bot.id, input);
      if (input.action) this.activateSpecial(bot.id);
    }

    // 1. Aplicar inputs → velocidad
    this.processInputs(dt, now);

    // 2. Colisiones entre jugadores
    this.resolveCollisions(now);

    // 3. Colisiones con obstáculos
    this.resolveObstacleCollisions();

    // 4. Aplicar boost zones
    this.applyBoostZones(now);

    // 5. Límites de arena
    this.checkBoundaries(now);

    // 6. Power-ups
    this.updateEffects(now);
    this.checkPowerUpCollisions(now);

    // 7. La transmisión de snapshots ocurre en un loop independiente.

    // 8. Win condition
    this.checkWinCondition();
  }

  // ─── Input ─────────────────────────────────────────────────────────────────

  /**
   * Rate limiting básico: máximo 125 inputs/s por jugador.
   * Los inputs válidos se encolan y se consumen en orden durante el tick.
   */
  handleInput(socketId, input) {
    const now   = Date.now();
    const last  = this._inputTimestamps.get(socketId) || 0;
    const delta = now - last;

    if (delta < 8) {   // > 125 inputs/s = sospechoso
      const warns = (this._inputWarnings.get(socketId) || 0) + 1;
      this._inputWarnings.set(socketId, warns);
      if (warns > 15) {
        console.warn(`[ANTICHEAT] Input flooding de ${socketId}, ignorado`);
        return;
      }
    } else {
      // Decaimiento de warnings
      const w = this._inputWarnings.get(socketId) || 0;
      if (w > 0) this._inputWarnings.set(socketId, w - 1);
    }

    this._inputTimestamps.set(socketId, now);

    this.inputQueue.enqueue(socketId, input);
  }

  processInputs(dt, now) {
    // Consumir inputs humanos en orden antes de aplicar movimiento.
    for (const [id, player] of this.players) {
      if (player.isBot) continue;
      this.inputQueue.consume(id, received => {
        this.inputs.set(id, { dx: received.dx, dy: received.dy, action: received.action });
        if (received.action) this.activateSpecial(id);
      });
    }

    for (const [id, input] of this.inputs) {
      const p = this.players.get(id);
      if (!p || !p.alive) continue;

      const { dx, dy } = input;

      if (dx === 0 && dy === 0) {
        p.vx *= FRICTION;
        p.vy *= FRICTION;
        continue;
      }

      const dir       = norm(dx, dy);
      const speedBoost= p.activeEffects.speed  && p.activeEffects.speed  > now ? 1.6 : 1.0;
      const sizeBoost = p.activeEffects.big     && p.activeEffects.big    > now ? 1.3 : 1.0;
      const boostMult = p.inBoostZone ? 1.35 : 1.0;

      const spd = p.speed * speedBoost * boostMult;

      p.vx += dir.x * spd * dt * 8;
      p.vy += dir.y * spd * dt * 8;

      const maxVel = spd;
      const vel    = Math.sqrt(p.vx*p.vx + p.vy*p.vy);
      if (vel > maxVel) { p.vx = p.vx/vel*maxVel; p.vy = p.vy/vel*maxVel; }

      p.angle  = Math.atan2(dir.y, dir.x);
      p.radius = PLAYER_RADIUS * (BOT_CLASSES[p.botClass]?.sizeMult || 1) * sizeBoost;
    }

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      p.vx *= PUSH_FRICTION;
      p.vy *= PUSH_FRICTION;
    }
  }

  // ─── Especial ──────────────────────────────────────────────────────────────

  activateSpecial(id) {
    const p   = this.players.get(id);
    if (!p || !p.alive) return;
    const now = Date.now();
    if (p.specialCooldown > now) return;

    const dir       = norm(Math.cos(p.angle), Math.sin(p.angle));
    const dashForce = PUSH_FORCE * (p.pushMult || 1);
    p.vx += dir.x * dashForce;
    p.vy += dir.y * dashForce;
    p.specialCooldown = now + SPECIAL_COOLDOWN;

    this.io.to(this.id).emit('player_dash', { playerId: id, dx: dir.x, dy: dir.y });
  }

  // ─── Colisiones entre jugadores ────────────────────────────────────────────

  resolveCollisions(now) {
    const alive = Array.from(this.players.values()).filter(p => p.alive);

    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const distance = Math.sqrt(dx*dx + dy*dy);
        const minDist  = a.radius + b.radius;

        if (distance >= minDist || distance < 0.1) continue;

        const overlap = minDist - distance;
        const nx = dx/distance, ny = dy/distance;
        const total = a.radius + b.radius;

        a.x -= nx * overlap * (b.radius/total);
        a.y -= ny * overlap * (b.radius/total);
        b.x += nx * overlap * (a.radius/total);
        b.y += ny * overlap * (a.radius/total);

        const relVx   = b.vx - a.vx, relVy = b.vy - a.vy;
        const vAlong  = relVx*nx + relVy*ny;
        if (vAlong > 0) continue;

        const restitution = 1.1;
        const impulse     = (-(1+restitution)*vAlong) / (1/a.radius + 1/b.radius);
        const base        = impulse * 0.045;

        const shA = a.activeEffects.shield && a.activeEffects.shield > now;
        const shB = b.activeEffects.shield && b.activeEffects.shield > now;

        if (!shA) { a.vx -= base/a.radius*nx*b.pushMult; a.vy -= base/a.radius*ny*b.pushMult; }
        if (!shB) { b.vx += base/b.radius*nx*a.pushMult; b.vy += base/b.radius*ny*a.pushMult; }

        const impact = Math.abs(vAlong);
        if (impact > 80) {
          a.pushCount++;
          if (!shA) { a.lastHitBy = b.id; a.lastHitTime = now; }
          if (!shB) { b.lastHitBy = a.id; b.lastHitTime = now; }

          // Emitir evento de colisión fuerte para audio en cliente
          if (impact > 160) {
            this.io.to(this.id).emit('collision_impact', {
              x: (a.x+b.x)/2, y: (a.y+b.y)/2,
              intensity: Math.min(impact/400, 1)
            });
          }
        }
      }
    }
  }

  // ─── Obstáculos ────────────────────────────────────────────────────────────

  resolveObstacleCollisions() {
    if (!this.map.obstacles?.length) return;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      for (const obs of this.map.obstacles) {
        const dx = p.x - obs.x, dy = p.y - obs.y;
        const d  = Math.sqrt(dx*dx + dy*dy);
        const min= p.radius + obs.radius;
        if (d >= min || d < 0.1) continue;

        const nx = dx/d, ny = dy/d;
        p.x += nx * (min - d);
        p.y += ny * (min - d);

        const dot = p.vx*nx + p.vy*ny;
        if (dot < 0) {
          p.vx -= (1 + 0.65) * dot * nx;
          p.vy -= (1 + 0.65) * dot * ny;
          this.io.to(this.id).emit('wall_hit', { playerId: p.id });
        }
      }
    }
  }

  // ─── Boost Zones ───────────────────────────────────────────────────────────

  applyBoostZones(now) {
    const zones = this.map.boostZones || [];
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      p.inBoostZone = false;

      for (const zone of zones) {
        const dx = p.x - zone.x, dy = p.y - zone.y;
        const d  = Math.sqrt(dx*dx + dy*dy);
        if (d < zone.radius + p.radius) {
          p.inBoostZone = true;

          // Impulso hacia afuera del centro de la zona (efecto "trampolín")
          const dir = norm(dx, dy);
          const bvel= Math.sqrt(p.vx*p.vx + p.vy*p.vy);
          if (bvel > 10) {
            p.vx += dir.x * 18 * (TICK_MS/1000);
            p.vy += dir.y * 18 * (TICK_MS/1000);
          }
          break;
        }
      }
    }
  }

  // ─── Límites de arena ──────────────────────────────────────────────────────

  checkBoundaries(now) {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = Math.sqrt(p.x*p.x + p.y*p.y);
      const boundary = ARENA_RADIUS - p.radius;

      if (d > boundary) {
        if (d < ARENA_RADIUS + 25) {
          const nx = p.x/d, ny = p.y/d;
          const dot= p.vx*nx + p.vy*ny;
          p.vx -= 2*dot*nx * 0.7;
          p.vy -= 2*dot*ny * 0.7;
          p.x   = nx * boundary;
          p.y   = ny * boundary;
        }
        if (d > ARENA_RADIUS + 5) {
          this.eliminatePlayer(p, now);
        }
      }
    }
  }

  eliminatePlayer(player, now) {
    player.alive = false;

    let killerId = null, killerNickname = null;
    if (player.lastHitBy && now - player.lastHitTime < KILLER_CREDIT_WINDOW) {
      const killer = this.players.get(player.lastHitBy);
      if (killer?.alive) {
        killer.eliminations++;
        killerId       = killer.id;
        killerNickname = killer.nickname;
      }
    }

    const remaining = Array.from(this.players.values()).filter(p => p.alive).length;
    this.io.to(this.id).emit('player_eliminated', {
      playerId:      player.id,
      nickname:      player.nickname,
      killerId,
      killerNickname,
      eliminations:  player.eliminations,
      remainingCount:remaining
    });

    console.log(`[ELIM] ${player.nickname}${killerNickname ? ` by ${killerNickname}` : ''} | sala ${this.id}`);
  }

  // ─── Power-ups ─────────────────────────────────────────────────────────────

  spawnPowerUp() {
    if (this.state !== 'playing' || this.powerUps.length >= 3) return;
    const angle = Math.random() * Math.PI * 2;
    const r     = Math.random() * ARENA_RADIUS * 0.65;
    const type  = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    const pu    = { id: Math.random().toString(36).substr(2,6), ...type,
                    x: Math.cos(angle)*r, y: Math.sin(angle)*r, radius: 14 };
    this.powerUps.push(pu);
    this.io.to(this.id).emit('powerup_spawned', pu);
  }

  checkPowerUpCollisions(now) {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      for (let i = this.powerUps.length - 1; i >= 0; i--) {
        const pu = this.powerUps[i];
        if (dist(p, pu) < p.radius + pu.radius) {
          p.activeEffects[pu.type] = now + pu.duration;
          this.powerUps.splice(i, 1);
          this.io.to(this.id).emit('powerup_collected', {
            playerId: p.id, powerUpId: pu.id,
            type: pu.type, label: pu.label, duration: pu.duration
          });
        }
      }
    }
  }

  updateEffects(now) {
    // Los efectos con timestamp expirado son ignorados automáticamente en processInputs.
    // Aquí solo enviamos evento de "expiración" si queremos notificar al cliente.
  }

  // ─── Win Condition ─────────────────────────────────────────────────────────

  checkWinCondition() {
    const alive = Array.from(this.players.values()).filter(p => p.alive);
    if (alive.length <= 1) this.endGame(alive[0] || null);
  }

  endGame(winner) {
    if (this.state === 'finished') return;
    this.state = 'finished';
    clearInterval(this.gameLoop);
    clearInterval(this.snapshotLoop);
    clearInterval(this.powerUpTimer);

    const results = Array.from(this.players.values())
      .sort((a,b) => b.eliminations - a.eliminations || b.pushCount - a.pushCount)
      .map(p => ({
        id: p.id, nickname: p.nickname, color: p.color, botClass: p.botClass,
        eliminations: p.eliminations, pushCount: p.pushCount, survived: p.alive
      }));

    const duration = Date.now() - this.startTime;

    this.io.to(this.id).emit('game_over', {
      winner: winner ? { id:winner.id, nickname:winner.nickname, color:winner.color } : null,
      results,
      duration
    });

    // Guardar en DB
    saveMatchResult({
      winner:     winner,
      players:    results,
      durationMs: duration,
      mapKey:     this.mapKey
    });

    // Limpiar bots
    this.bots = [];

    console.log(`[END] ${this.id} | ganador: ${winner?.nickname || 'Nadie'} | ${Math.round(duration/1000)}s`);

    setTimeout(() => { if (this.players.size > 0) this.resetToLobby(); }, 10000);
  }

  resetToLobby() {
    this.state     = 'lobby';
    this.powerUps  = [];
    this.tickCount = 0;
    this.bots      = [];

    // Remover jugadores bot del mapa
    for (const [id, p] of this.players) {
      if (p.isBot) {
        this.players.delete(id);
        this.inputs.delete(id);
      } else {
        p.alive = true; p.vx = 0; p.vy = 0;
        p.eliminations = 0; p.pushCount = 0; p.activeEffects = {};
      }
    }

    // Cambiar mapa al resetear
    const keys  = Object.keys(MAPS);
    this.mapKey = keys[Math.floor(Math.random() * keys.length)];
    this.map    = MAPS[this.mapKey];

    this.io.to(this.id).emit('back_to_lobby', { room: this.getPublicState() });
  }

  // ─── Broadcast de snapshot completo ───────────────────────────────────────

  broadcastState(now) {
    this.io.to(this.id).emit('game_state', this.snapshotSystem.create(this, now));
  }

  // ─── Chat ──────────────────────────────────────────────────────────────────

  addChatMessage(socketId, message) {
    const p = this.players.get(socketId);
    if (!p || p.isBot) return;
    const clean = String(message).slice(0, 120).replace(/[<>&"]/g, '');
    if (!clean.trim()) return;
    const msg = { id: Date.now(), playerId: socketId, nickname: p.nickname,
                  color: p.color, text: clean, ts: Date.now() };
    this.chatHistory.push(msg);
    if (this.chatHistory.length > 50) this.chatHistory.shift();
    this.io.to(this.id).emit('chat_message', msg);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  getPlayersState() {
    return Array.from(this.players.values()).map(p => ({
      id: p.id, nickname: p.nickname, color: p.color, botClass: p.botClass,
      x: p.x, y: p.y, radius: p.radius, alive: p.alive, isBot: p.isBot
    }));
  }

  getPublicState() {
    return {
      id: this.id, name: this.name, state: this.state,
      hostId: this.hostId, maxPlayers: this.maxPlayers,
      mapName: this.map.name,
      chatHistory: this.chatHistory.slice(-20),
      players: Array.from(this.players.values())
        .filter(p => !p.isBot)
        .map(p => ({ id: p.id, nickname: p.nickname, color: p.color, botClass: p.botClass, isHost: p.id === this.hostId }))
    };
  }

  destroy() {
    clearInterval(this.gameLoop);
    clearInterval(this.snapshotLoop);
    clearInterval(this.powerUpTimer);
    clearInterval(this.countdownTimer);
    this.inputQueue.clear();
    this.bots = [];
  }
}

module.exports = { GameRoom };
