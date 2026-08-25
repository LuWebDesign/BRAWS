/**
 * renderer.js
 * 
 * Motor de renderizado Canvas 2D.
 * Maneja: arena, jugadores, power-ups, efectos visuales, partículas.
 * 
 * Usa interpolación del lado del cliente para suavizar el movimiento
 * entre ticks del servidor (lag compensation visual).
 */

class SnapshotBuffer {
  constructor(maxSnapshots = 32) {
    this.maxSnapshots = maxSnapshots;
    this.snapshots = [];
  }

  clear() {
    this.snapshots = [];
  }

  add(snapshot) {
    if (!snapshot || !Number.isFinite(snapshot.t)) return;
    this.snapshots.push({
      t: snapshot.t,
      players: snapshot.players.map(player => ({ ...player })),
      powerUps: snapshot.powerUps || [],
    });
    while (this.snapshots.length > this.maxSnapshots) this.snapshots.shift();
  }

  sample(playerId, renderTime) {
    if (!this.snapshots.length) return null;

    let older = null;
    let newer = null;
    for (const snapshot of this.snapshots) {
      const player = snapshot.players.find(candidate => candidate.id === playerId);
      if (!player) continue;
      if (snapshot.t <= renderTime) older = { snapshot, player };
      if (snapshot.t >= renderTime) {
        newer = { snapshot, player };
        break;
      }
    }

    if (!older) return newer?.player || null;
    if (!newer || newer.snapshot.t === older.snapshot.t) return older.player;

    const span = newer.snapshot.t - older.snapshot.t;
    const factor = Math.max(0, Math.min(1, (renderTime - older.snapshot.t) / span));
    return {
      ...newer.player,
      x: lerp(older.player.x, newer.player.x, factor),
      y: lerp(older.player.y, newer.player.y, factor),
      angle: lerpAngle(older.player.angle, newer.player.angle, factor),
    };
  }
}

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    
    // Estado interpolado del juego
    this.players = new Map();
    this.powerUps = [];
    this.particles = [];
    this.dashEffects = [];
    this.eliminationEffects = [];
    this.shakeEffects = [];     // { x, y, intensity, life } — shake localizado
    
    // Referencia al jugador local
    this.localPlayerId = null;
    this.localPlayerData = null;
    this.predictedLocalState = null;
    this.localCorrection = { x: 0, y: 0 };
    this.spectatorTarget = null; // id del jugador a seguir como espectador
    
    // Mapa
    this.obstacles = [];        // { x, y, radius }
    this.boostZones = [];      // { x, y, radius, factor, color }
    this.mapKey = 'circle';
    
    // Cámara
    this.camera = { x: 0, y: 0, zoom: 1, targetZoom: 1, shakeX: 0, shakeY: 0 };
    
    // Arena
    this.arenaRadius = 380;
    
    // Tiempo para interpolación
    this.lastStateTime = 0;
    this.interpolationDelay = 100;
    this.serverClockOffset = null;
    this.snapshotBuffer = new SnapshotBuffer();
    
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    // Calcular zoom base para que la arena quepa bien
    const minDim = Math.min(this.canvas.width, this.canvas.height);
    this.baseZoom = (minDim * 0.45) / this.arenaRadius;
  }

  // ─── Actualizar estado del servidor ──────────────────────────────────────

  setPredictedLocalState(state) {
    if (!state || !this.localPlayerId) return;
    this.predictedLocalState = { ...state };
    const player = this.players.get(this.localPlayerId);
    if (!player) return;
    player.x = state.x + this.localCorrection.x;
    player.y = state.y + this.localCorrection.y;
    player.vx = state.vx || 0;
    player.vy = state.vy || 0;
    player.angle = state.angle || 0;
    player.alive = state.alive;
  }

  reconcileLocalState(state, smoothCorrection) {
    if (!state || !this.localPlayerId) return;
    const player = this.players.get(this.localPlayerId);
    if (!player) return;

    if (smoothCorrection) {
      this.localCorrection.x = player.x - state.x;
      this.localCorrection.y = player.y - state.y;
    } else {
      this.localCorrection.x = 0;
      this.localCorrection.y = 0;
    }

    this.predictedLocalState = { ...state };
    player.x = state.x + this.localCorrection.x;
    player.y = state.y + this.localCorrection.y;
    player.vx = state.vx || 0;
    player.vy = state.vy || 0;
    player.angle = state.angle || 0;
    player.alive = state.alive;
  }

  updateState(state) {
    const now = Date.now();
    this.lastStateTime = now;
    this.snapshotBuffer.add(state);
    if (Number.isFinite(state.t)) {
      const measuredOffset = now - state.t;
      this.serverClockOffset = this.serverClockOffset === null
        ? measuredOffset
        : this.serverClockOffset * 0.9 + measuredOffset * 0.1;
    }

    for (const serverPlayer of state.players) {
      if (!this.players.has(serverPlayer.id)) {
        // Nuevo jugador → inicializar
        this.players.set(serverPlayer.id, {
          id: serverPlayer.id,
          x: serverPlayer.x,
          y: serverPlayer.y,
          vx: serverPlayer.vx || 0,
          vy: serverPlayer.vy || 0,
          angle: serverPlayer.angle || 0,
          alive: serverPlayer.alive,
          radius: serverPlayer.radius,
          nickname: serverPlayer.nickname || '',
          color: serverPlayer.color || '#fff',
          botClass: serverPlayer.botClass,
          // HUD
          specialReady: serverPlayer.specialReady,
          specialCooldownPct: serverPlayer.specialCooldownPct,
          hasShield: serverPlayer.hasShield,
          hasSpeed: serverPlayer.hasSpeed,
          isBig: serverPlayer.isBig,
          invincible: serverPlayer.invincible,
          // Interpolación
          prevX: serverPlayer.x,
          prevY: serverPlayer.y,
          targetX: serverPlayer.x,
          targetY: serverPlayer.y,
        });
      } else {
        const p = this.players.get(serverPlayer.id);
        const isLocal = serverPlayer.id === this.localPlayerId;
        if (isLocal) {
          // El jugador local se dibuja desde el estado predicho. Conservamos
          // el estado del servidor para la futura fase de reconciliation.
          p.authoritativeX = serverPlayer.x;
          p.authoritativeY = serverPlayer.y;
          p.authoritativeVx = serverPlayer.vx || 0;
          p.authoritativeVy = serverPlayer.vy || 0;
        } else {
          // Los remotos sí interpolan entre snapshots.
          p.prevX = p.x;
          p.prevY = p.y;
          p.targetX = serverPlayer.x;
          p.targetY = serverPlayer.y;
        }
        p.angle = serverPlayer.angle;
        p.alive = serverPlayer.alive;
        p.radius = serverPlayer.radius;
        // Stats
        p.specialReady = serverPlayer.specialReady;
        p.specialCooldownPct = serverPlayer.specialCooldownPct;
        p.hasShield = serverPlayer.hasShield;
        p.hasSpeed = serverPlayer.hasSpeed;
        p.isBig = serverPlayer.isBig;
        p.invincible = serverPlayer.invincible;
        p.vx = serverPlayer.vx || 0;
        p.vy = serverPlayer.vy || 0;
      }

      if (serverPlayer.id === this.localPlayerId) {
        this.localPlayerData = this.players.get(serverPlayer.id);
      }
    }

    // Remover jugadores que ya no están
    for (const [id] of this.players) {
      if (!state.players.find(p => p.id === id)) {
        this.players.delete(id);
      }
    }

    this.powerUps = state.powerUps || [];
  }

  // ─── Shake de cámara ─────────────────────────────────────────────────────

  /**
   * @param {number} intensity — intensidad en píxeles (se escala por zoom)
   * @param {number} duration  — duración en ms
   */
  shakeCamera(intensity = 8, duration = 300) {
    this._shakeDuration = duration;
    this._shakeIntensity = intensity;
    this._shakeStart = Date.now();
  }

  // ─── Modo espectador ──────────────────────────────────────────────────────

  /**
   * Ciclar al siguiente jugador vivo para seguir como espectador
   */
  cycleSpectatorTarget() {
    const alive = Array.from(this.players.values()).filter(p => p.alive);
    if (alive.length === 0) return;

    const currentIdx = alive.findIndex(p => p.id === this.spectatorTarget);
    const nextIdx = (currentIdx + 1) % alive.length;
    this.spectatorTarget = alive[nextIdx].id;
  }

  // ─── Efectos Visuales ────────────────────────────────────────────────────

  addDashEffect(playerId, dx, dy) {
    const player = this.players.get(playerId);
    if (!player) return;

    this.dashEffects.push({
      x: player.x,
      y: player.y,
      dx, dy,
      color: player.color,
      life: 1.0,
      maxLife: 1.0
    });
  }

  addEliminationEffect(x, y, color) {
    // Generar partículas de explosión
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2 + Math.random() * 0.3;
      const speed = 60 + Math.random() * 140;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        radius: 2 + Math.random() * 4,
        life: 1.0,
        decay: 0.025 + Math.random() * 0.02
      });
    }

    this.eliminationEffects.push({
      x, y, color,
      radius: 0,
      maxRadius: 60,
      life: 1.0
    });
  }

  addCollisionSpark(x, y, color) {
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 60;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        radius: 1.5,
        life: 0.7,
        decay: 0.04
      });
    }
  }

  // ─── Loop de Renderizado ─────────────────────────────────────────────────

  render(timestamp) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // Limpiar
    ctx.fillStyle = '#060a12';
    ctx.fillRect(0, 0, W, H);

    // ── Camera shake ────────────────────────────────────────────────────────
    let shakeX = 0, shakeY = 0;
    if (this._shakeStart) {
      const elapsed = Date.now() - this._shakeStart;
      const progress = elapsed / (this._shakeDuration || 300);
      if (progress < 1) {
        const decay = 1 - progress;
        shakeX = (Math.random() - 0.5) * this._shakeIntensity * decay * 2;
        shakeY = (Math.random() - 0.5) * this._shakeIntensity * decay * 2;
      } else {
        this._shakeStart = null;
      }
    }

    // ── Seguir jugador (normal o espectador) ────────────────────────────────
    const followId = this.localPlayerData?.alive
      ? this.localPlayerId
      : (this.spectatorTarget || this.localPlayerId);

    const followPlayer = this.players.get(followId);

    // Cámara suave hacia el jugador seguido (solo si la arena es grande)
    if (followPlayer && this.arenaRadius > 500) {
      this.camera.x += (-followPlayer.x * this.baseZoom - this.camera.x) * 0.08;
      this.camera.y += (-followPlayer.y * this.baseZoom - this.camera.y) * 0.08;
    } else {
      this.camera.x += (0 - this.camera.x) * 0.05;
      this.camera.y += (0 - this.camera.y) * 0.05;
    }

    // Interpolación suave del zoom
    this.camera.zoom += (this.camera.targetZoom - this.camera.zoom) * 0.08;
    const zoom = this.baseZoom * this.camera.zoom;

    // Transform: centrar en el canvas
    ctx.save();
    ctx.translate(W / 2 + this.camera.x + shakeX, H / 2 + this.camera.y + shakeY);
    ctx.scale(zoom, zoom);

    // Interpolar remotos desde snapshots históricos y decaer correcciones
    // pequeñas del jugador local.
    const serverNow = Date.now() - (this.serverClockOffset || 0);
    const renderTime = serverNow - this.interpolationDelay;
    for (const player of this.players.values()) {
      if (player.id === this.localPlayerId && this.predictedLocalState) {
        this.localCorrection.x *= 0.2;
        this.localCorrection.y *= 0.2;
        player.x = this.predictedLocalState.x + this.localCorrection.x;
        player.y = this.predictedLocalState.y + this.localCorrection.y;
      } else if (player.alive) {
        const sample = this.snapshotBuffer.sample(player.id, renderTime);
        if (sample) {
          player.x = sample.x;
          player.y = sample.y;
          player.angle = sample.angle;
          player.alive = sample.alive;
        }
      }
    }

    // Renderizar capas
    this.drawArenaBackground(ctx);
    this.drawArena(ctx);
    this.drawBoostZones(ctx, timestamp);
    this.drawObstacles(ctx, timestamp);
    this.drawPowerUps(ctx, timestamp);
    this.drawDashEffects(ctx);
    this.drawParticles(ctx);
    this.drawEliminationEffects(ctx);
    this.drawPlayers(ctx, timestamp);

    ctx.restore();

    // ── Overlay espectador ──────────────────────────────────────────────────
    if (this.localPlayerData && !this.localPlayerData.alive) {
      this._drawSpectatorOverlay(ctx, followPlayer);
    }

    // Actualizar partículas
    this.updateParticles();
  }

  _drawSpectatorOverlay(ctx, target) {
    const W = this.canvas.width;

    ctx.save();
    ctx.fillStyle = 'rgba(255, 100, 50, 0.12)';
    ctx.fillRect(0, 0, W, 36);

    ctx.font = `bold 13px 'Orbitron', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,200,150,0.85)';
    ctx.fillText(
      target
        ? `👁 ESPECTANDO: ${target.nickname}   [TAB = cambiar]`
        : '💀 ELIMINADO — Esperando fin de partida...',
      W / 2, 18
    );
    ctx.restore();
  }

  // ─── Arena ───────────────────────────────────────────────────────────────

  drawArenaBackground(ctx) {
    const R = this.arenaRadius;

    // Fondo del espacio exterior (peligroso)
    ctx.save();
    ctx.globalAlpha = 0.4;

    // Grid perspectivo de fondo
    const gridSize = 60;
    ctx.strokeStyle = 'rgba(0, 100, 150, 0.15)';
    ctx.lineWidth = 0.5;
    for (let x = -R * 2; x <= R * 2; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, -R * 2);
      ctx.lineTo(x, R * 2);
      ctx.stroke();
    }
    for (let y = -R * 2; y <= R * 2; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(-R * 2, y);
      ctx.lineTo(R * 2, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawArena(ctx) {
    const R = this.arenaRadius;

    // Sombra exterior (zona de peligro)
    const dangerGrad = ctx.createRadialGradient(0, 0, R * 0.85, 0, 0, R * 1.1);
    dangerGrad.addColorStop(0, 'rgba(255, 50, 50, 0)');
    dangerGrad.addColorStop(1, 'rgba(255, 50, 50, 0.25)');
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.15, 0, Math.PI * 2);
    ctx.fillStyle = dangerGrad;
    ctx.fill();

    // Clip a la arena
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.clip();

    // Fondo de arena
    const bgGrad = ctx.createRadialGradient(0, -R * 0.3, 0, 0, 0, R);
    bgGrad.addColorStop(0, '#0e1828');
    bgGrad.addColorStop(1, '#080f1a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(-R, -R, R * 2, R * 2);

    // Líneas decorativas concéntricas
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let r = R * 0.2; r < R; r += R * 0.2) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cruz central
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-R, 0); ctx.lineTo(R, 0);
    ctx.moveTo(0, -R); ctx.lineTo(0, R);
    ctx.stroke();

    ctx.restore();

    // Borde de la arena
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.6)';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(0, 200, 255, 0.8)';
    ctx.shadowBlur = 20;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Indicadores de borde peligroso
    ctx.strokeStyle = 'rgba(255, 60, 60, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.arc(0, 0, R - 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ─── Boost zones ──────────────────────────────────────────────────────────

  drawBoostZones(ctx, timestamp) {
    if (!this.boostZones?.length) return;

    for (const zone of this.boostZones) {
      const pulse = Math.sin(timestamp * 0.003 + zone.x * 0.01) * 0.25 + 0.75;
      const r = zone.radius;

      ctx.save();
      ctx.translate(zone.x, zone.y);
      ctx.shadowColor = zone.color;
      ctx.shadowBlur = 20 * pulse;
      ctx.rotate((timestamp * 0.0008) % (Math.PI * 2));
      ctx.setLineDash([8, 5]);
      ctx.strokeStyle = zone.color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7 * pulse;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.globalAlpha = 0.12 * pulse;
      ctx.fillStyle = zone.color;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.8 * pulse;
      ctx.shadowBlur = 0;
      ctx.font = `bold ${Math.round(r * 0.7)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = zone.color;
      ctx.fillText('⚡', 0, 0);
      ctx.restore();
    }
  }

  // ─── Obstáculos del mapa ──────────────────────────────────────────────────

  drawObstacles(ctx, timestamp) {
    for (const obs of this.obstacles) {
      const pulse = Math.sin(timestamp * 0.002 + obs.x) * 0.05 + 0.95;

      ctx.save();
      ctx.translate(obs.x, obs.y);

      // Sombra del obstáculo
      ctx.shadowColor = 'rgba(0,200,255,0.4)';
      ctx.shadowBlur = 15;

      // Cuerpo hexagonal (más interesante que círculo)
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 - Math.PI / 6;
        const r = obs.radius * pulse;
        if (i === 0) ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
        else ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
      }
      ctx.closePath();

      // Relleno con gradiente
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, obs.radius);
      grad.addColorStop(0, 'rgba(0,100,150,0.7)');
      grad.addColorStop(1, 'rgba(0,30,60,0.9)');
      ctx.fillStyle = grad;
      ctx.fill();

      // Borde
      ctx.strokeStyle = 'rgba(0,200,255,0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Detalle interior: círculo pequeño
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(0, 0, obs.radius * 0.3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,200,255,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();
    }
  }

  // ─── Power-Ups ───────────────────────────────────────────────────────────

  drawPowerUps(ctx, timestamp) {
    for (const pu of this.powerUps) {
      const pulse = Math.sin(timestamp * 0.004) * 0.3 + 0.7;
      const r = 14 * pulse;

      ctx.save();
      ctx.translate(pu.x, pu.y);

      // Glow
      ctx.shadowColor = pu.color;
      ctx.shadowBlur = 20 * pulse;

      // Cuerpo
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = pu.color;
      ctx.globalAlpha = 0.2;
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.strokeStyle = pu.color;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Icono
      ctx.shadowBlur = 0;
      ctx.fillStyle = pu.color;
      ctx.font = `bold ${12 * pulse}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const icons = { speed: '⚡', shield: '🛡', big: '💥' };
      ctx.fillText(icons[pu.type] || '?', 0, 0);

      ctx.restore();
    }
  }

  // ─── Jugadores ───────────────────────────────────────────────────────────

  drawPlayers(ctx, timestamp) {
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      this.drawPlayer(ctx, player, timestamp);
    }
  }

  drawPlayer(ctx, player, timestamp) {
    const { x, y, angle, radius, color, nickname, invincible } = player;
    const isLocal = player.id === this.localPlayerId;

    ctx.save();
    ctx.translate(x, y);

    if (player.inBoostZone) {
      const pulse = Math.sin(timestamp * 0.008) * 0.3 + 0.7;
      ctx.beginPath();
      ctx.arc(0, 0, player.radius + 8 * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = '#00ffcc';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5 * pulse;
      ctx.shadowColor = '#00ffcc';
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    // Parpadeo si invincible
    if (invincible && Math.floor(timestamp / 100) % 2 === 0) {
      ctx.restore();
      return;
    }

    // ── Shield visual ──────────────────────────────────────────────────────
    if (player.hasShield) {
      const shieldPulse = Math.sin(timestamp * 0.005) * 0.2 + 0.8;
      ctx.beginPath();
      ctx.arc(0, 0, radius + 10 * shieldPulse, 0, Math.PI * 2);
      ctx.strokeStyle = '#4488ff';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.6 * shieldPulse;
      ctx.shadowColor = '#4488ff';
      ctx.shadowBlur = 15;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    // ── Cuerpo del bot ────────────────────────────────────────────────────
    const effectColor = player.hasSpeed ? '#00ff88' :
                        player.isBig    ? '#ff4444' : color;

    // Sombra glow
    ctx.shadowColor = effectColor;
    ctx.shadowBlur = isLocal ? 25 : 15;

    // Cuerpo principal (círculo)
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);

    const bodyGrad = ctx.createRadialGradient(-radius * 0.3, -radius * 0.3, 0, 0, 0, radius);
    bodyGrad.addColorStop(0, lightenColor(effectColor, 40));
    bodyGrad.addColorStop(1, darkenColor(effectColor, 20));
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // Borde del jugador local (diferenciador)
    if (isLocal) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    ctx.shadowBlur = 0;

    // ── Cañón del bot ─────────────────────────────────────────────────────
    ctx.rotate(angle);
    ctx.fillStyle = darkenColor(effectColor, 30);
    ctx.beginPath();
    ctx.roundRect(radius * 0.4, -radius * 0.22, radius * 0.75, radius * 0.44, 3);
    ctx.fill();

    // Highlight del cañón
    ctx.fillStyle = lightenColor(effectColor, 20);
    ctx.beginPath();
    ctx.roundRect(radius * 0.42, -radius * 0.12, radius * 0.55, radius * 0.16, 2);
    ctx.fill();

    ctx.restore();

    // ── Nickname ──────────────────────────────────────────────────────────
    ctx.save();
    ctx.translate(x, y);

    const tag = isLocal ? `▶ ${nickname}` : nickname;
    ctx.font = `bold 12px 'Rajdhani', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    // Fondo del nombre
    const textW = ctx.measureText(tag).width;
    ctx.fillStyle = 'rgba(6, 10, 18, 0.7)';
    ctx.fillRect(-textW / 2 - 4, -radius - 22, textW + 8, 16);

    ctx.fillStyle = isLocal ? '#00c8ff' : '#e0f0ff';
    ctx.fillText(tag, 0, -radius - 8);

    ctx.restore();
  }

  // ─── Efectos de Dash ─────────────────────────────────────────────────────

  drawDashEffects(ctx) {
    for (let i = this.dashEffects.length - 1; i >= 0; i--) {
      const e = this.dashEffects[i];
      
      ctx.save();
      ctx.globalAlpha = e.life * 0.6;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 8 * e.life;
      ctx.lineCap = 'round';
      ctx.shadowColor = e.color;
      ctx.shadowBlur = 15;
      
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x - e.dx * 60 * (1 - e.life), e.y - e.dy * 60 * (1 - e.life));
      ctx.stroke();

      ctx.restore();

      e.life -= 0.06;
      if (e.life <= 0) this.dashEffects.splice(i, 1);
    }
  }

  // ─── Partículas ───────────────────────────────────────────────────────────

  drawParticles(ctx) {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  updateParticles() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * 0.016;
      p.y += p.vy * 0.016;
      p.vx *= 0.95;
      p.vy *= 0.95;
      p.life -= p.decay;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  drawEliminationEffects(ctx) {
    for (let i = this.eliminationEffects.length - 1; i >= 0; i--) {
      const e = this.eliminationEffects[i];
      
      ctx.save();
      ctx.globalAlpha = e.life * 0.4;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 3 * e.life;
      ctx.shadowColor = e.color;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      e.radius += 5;
      e.life -= 0.04;
      if (e.life <= 0) this.eliminationEffects.splice(i, 1);
    }
  }
}

// ─── Helpers de color ─────────────────────────────────────────────────────────
function lerpAngle(a, b, t) {
  let delta = (b - a + Math.PI) % (Math.PI * 2) - Math.PI;
  return a + delta * t;
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function lightenColor(hex, amount) {
  try {
    const { r, g, b } = hexToRgb(hex);
    return `rgb(${Math.min(255, r + amount)}, ${Math.min(255, g + amount)}, ${Math.min(255, b + amount)})`;
  } catch { return hex; }
}

function darkenColor(hex, amount) {
  try {
    const { r, g, b } = hexToRgb(hex);
    return `rgb(${Math.max(0, r - amount)}, ${Math.max(0, g - amount)}, ${Math.max(0, b - amount)})`;
  } catch { return hex; }
}
