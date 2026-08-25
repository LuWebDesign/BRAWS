/**
 * game.js
 *
 * Núcleo del cliente de juego.
 * Gestiona: conexión Socket.io, game loop, HUD, audio, kill feed, chat, espectador.
 */

class Game {
  constructor() {
    this.canvas        = document.getElementById('game-canvas');
    this.renderer      = new Renderer(this.canvas);
    this.input         = new InputHandler();
    this.socket        = null;
    this.roomId        = null;
    this.localPlayerId = null;
    this.gameActive    = false;
    this.isAlive       = true;
    this.animFrame     = null;
    this.lastInputSent = 0;
    this.inputSequence = 0;
    this.pendingInputs = [];
    this.predictedLocalState = null;
    this.predictedSpecialReadyAt = 0;
    this.INPUT_RATE    = 1000 / 60;
    this.PREDICTION_DT = 1 / 60;
    this.ping          = 0;
    this.pingInterval  = null;
    this._prevVelocities = new Map();

    // HUD refs
    this.hudAlive         = document.getElementById('hud-alive');
    this.hudPing          = document.getElementById('hud-ping');
    this.specialBarFill   = document.getElementById('special-bar-fill');
    this.cooldownRing     = document.getElementById('cooldown-ring');
    this.effectIndicators = document.getElementById('effect-indicators');
    this.hudMapName       = document.getElementById('hud-map-name');
  }

  connect(serverUrl) {
    this.socket = io(serverUrl, { transports: ['websocket'], reconnection: true, reconnectionDelay: 1000 });
    this._bindSocketEvents();
    this._startPing();
    return this.socket;
  }

  _bindSocketEvents() {
    const s = this.socket;

    s.on('connect', () => {
      this.localPlayerId = s.id;
      this.renderer.localPlayerId = s.id;
      console.log('[SOCKET] Conectado:', s.id);
    });

    s.on('disconnect', () => {
      this.gameActive = false;
      audio.stopMusic();
      toast('Desconectado del servidor', 'error');
    });

    s.on('error', ({ message }) => toast(message, 'error'));

    // ── Lobby ────────────────────────────────────────────────────────────
    s.on('room_created', ({ roomId, room }) => { this.roomId = roomId; UI.showLobby(room, s.id); });
    s.on('room_joined',  ({ roomId, room }) => { this.roomId = roomId; UI.showLobby(room, s.id); });
    s.on('player_joined', ({ room })        => UI.updateLobby(room, s.id));
    s.on('player_left',   ({ room })        => UI.updateLobby(room, s.id));
    s.on('rooms_updated', (rooms)           => UI.updateRoomsList(rooms));
    s.on('chat_message',  (msg)             => UI.addChatMessage(msg, s.id));

    s.on('new_host', ({ hostId }) => {
      if (hostId === s.id) {
        toast('¡Sos el nuevo host!', 'warn');
        document.getElementById('btn-start').disabled = false;
      }
    });

    // ── Countdown ────────────────────────────────────────────────────────
    s.on('countdown', ({ count }) => {
      UI.showCountdown(count);
      audio.playCountdown(count);
    });

    // ── Game started ──────────────────────────────────────────────────────
    s.on('game_started', ({ players, arenaRadius, map }) => {
      this.renderer.arenaRadius = arenaRadius;
      this.renderer.obstacles   = map?.obstacles || [];
      this.renderer.boostZones   = map?.boostZones || [];
      this.renderer.mapKey      = map?.key || 'circle';
      this.renderer.resize();
      this.renderer.players.clear();
      this.renderer.snapshotBuffer.clear();
      this.renderer.serverClockOffset = null;

      for (const p of players) {
        this.renderer.players.set(p.id, {
          ...p, prevX: p.x, prevY: p.y, targetX: p.x, targetY: p.y,
          angle: 0, vx: 0, vy: 0, activeEffects: {}
        });
        if (p.id === s.id) this.renderer.localPlayerData = this.renderer.players.get(p.id);
      }

      this.renderer.spectatorTarget = players.find(p => p.id !== s.id)?.id || null;
      this.isAlive       = true;
      this.inputSequence = 0;
      this.pendingInputs = [];
      this.predictedSpecialReadyAt = 0;
      this.predictedLocalState = players.find(p => p.id === s.id)
        ? { ...players.find(p => p.id === s.id) }
        : null;
      this.gameActive    = true;

      if (this.hudMapName) this.hudMapName.textContent = map?.name || '';
      UI.clearKillFeed();
      UI.hideCountdown();
      UI.showScreen('screen-game');
      this._startGameLoop();
      audio.startGameMusic();
    });

    // ── Game state (60/s) ─────────────────────────────────────────────────
    s.on('game_state', (state) => {
      if (!this.gameActive) return;

      // Detectar delta de velocidad fuerte → colisión → audio + shake
      for (const sp of state.players) {
        if (!sp.alive) continue;
        const prev = this._prevVelocities.get(sp.id);
        if (prev) {
          const dvx = (sp.vx||0) - prev.vx;
          const dvy = (sp.vy||0) - prev.vy;
          const delta = Math.sqrt(dvx*dvx + dvy*dvy);
          if (delta > 130) {
            const intensity = Math.min(delta / 400, 1);
            if (sp.id === s.id) this.renderer.shakeCamera(intensity * 11, 220);
            if (sp.id === s.id || delta > 260) audio.playCollision(intensity);
          }
        }
        this._prevVelocities.set(sp.id, { vx: sp.vx||0, vy: sp.vy||0 });
      }

      this.renderer.updateState(state);
      this._syncPredictedState(state.players.find(p => p.id === this.localPlayerId));
      this._updateHUD(state);
    });

    // ── Dash ──────────────────────────────────────────────────────────────
    s.on('player_dash', ({ playerId, dx, dy }) => {
      this.renderer.addDashEffect(playerId, dx, dy);
      if (playerId === s.id) audio.playDash();
    });

    s.on('wall_hit', ({ playerId }) => {
      if (playerId === s.id) {
        audio.playWallHit();
        this.renderer.shakeCamera(4, 100);
      }
    });

    s.on('collision_impact', ({ x, y, intensity }) => {
      this.renderer.addCollisionSpark(x, y, intensity > 0.5 ? '#ffffff' : '#00c8ff');
    });

    // ── Eliminación ───────────────────────────────────────────────────────
    s.on('player_eliminated', ({ playerId, nickname, killerId, killerNickname, remainingCount }) => {
      const player = this.renderer.players.get(playerId);
      if (player) {
        this.renderer.addEliminationEffect(player.x, player.y, player.color);
        this.renderer.shakeCamera(10, 380);
        player.alive = false;
      }

      this._updateAliveCount(remainingCount);

      UI.addKillFeedEntry({
        victim: nickname,
        killer: killerNickname,
        victimColor: player?.color || '#fff',
        isLocal: playerId === s.id
      });

      if (playerId === s.id) {
        this.isAlive = false;
        audio.playLocalDeath();
        this.renderer.shakeCamera(22, 600);
        this._onLocalEliminated();
      } else {
        audio.playElimination();
        if (killerId === s.id) toast(`💀 Eliminaste a ${nickname}!`, 'success');
      }
    });

    // ── Power-ups ─────────────────────────────────────────────────────────
    s.on('powerup_spawned', () => audio.playPowerUpSpawn());
    s.on('powerup_collected', ({ playerId, type, label }) => {
      if (playerId === s.id) { toast(label, 'success'); audio.playPowerUp(type); }
    });

    // ── Game over ─────────────────────────────────────────────────────────
    s.on('game_over', (data) => {
      this.gameActive = false;
      this._stopGameLoop();
      audio.stopMusic();
      if (data.winner?.id === s.id) audio.playVictory();
      else audio.playDefeat();
      setTimeout(() => UI.showGameOver(data, s.id), 800);
    });

    s.on('back_to_lobby', ({ room }) => {
      this._stopGameLoop();
      this.gameActive = false;
      audio.stopMusic();
      UI.showLobby(room, s.id);
    });

    // ── Ping ──────────────────────────────────────────────────────────────
    s.on('pong_check', (ts) => {
      this.ping = Date.now() - ts;
      const el = document.getElementById('ping-display');
      if (el) el.textContent = `PING: ${this.ping}ms`;
      if (this.hudPing) {
        this.hudPing.textContent = `${this.ping}ms`;
        this.hudPing.style.color = this.ping > 150 ? '#ff4444' : this.ping > 80 ? '#ffaa00' : '#00ff88';
      }
    });
  }

  // ─── Game Loop ──────────────────────────────────────────────────────────

  _startGameLoop() {
    let lastSpecialReady = true;

    const loop = (timestamp) => {
      if (!this.gameActive) return;
      const now = Date.now();

      if (now - this.lastInputSent >= this.INPUT_RATE) {
        const input = {
          ...this.input.getInput(),
          seq: this.inputSequence++,
        };
        if (this.isAlive) {
          this.pendingInputs.push(input);
          this._applyLocalPrediction(input, this.PREDICTION_DT, now);
          this.socket.emit('player_input', input);
          this.renderer.setPredictedLocalState(this.predictedLocalState);
        }

        // Sonido cuando el especial vuelve a estar disponible
        const local = this.renderer.players.get(this.localPlayerId);
        if (local) {
          if (local.specialReady && !lastSpecialReady) {
            audio._tone({ freq: 660, type: 'sine', gain: 0.15, duration: 0.1, attack: 0.005 });
            audio._tone({ freq: 880, type: 'sine', gain: 0.1,  duration: 0.12, attack: 0.005, start: 0.07 });
          }
          lastSpecialReady = local.specialReady;
        }

        this.input.lastInput = input;
        this.lastInputSent = now;
      }

      this.renderer.render(timestamp);
      this.animFrame = requestAnimationFrame(loop);
    };

    this.animFrame = requestAnimationFrame(loop);
  }

  _stopGameLoop() {
    if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = null; }
    this._prevVelocities.clear();
    this.pendingInputs = [];
    this.predictedLocalState = null;
  }

  _syncPredictedState(serverPlayer) {
    if (!serverPlayer) return;

    const acknowledged = Number.isSafeInteger(serverPlayer.lastProcessedInput)
      ? serverPlayer.lastProcessedInput
      : -1;
    const previous = this.predictedLocalState;
    this.pendingInputs = this.pendingInputs.filter(input => input.seq > acknowledged);

    const predicted = {
      ...serverPlayer,
      x: serverPlayer.x,
      y: serverPlayer.y,
      vx: serverPlayer.vx || 0,
      vy: serverPlayer.vy || 0,
      angle: serverPlayer.angle || 0,
    };

    if (serverPlayer.specialReady) this.predictedSpecialReadyAt = 0;
    this.predictedLocalState = predicted;

    // Reconstruir el estado local desde la autoridad y reproducir únicamente
    // inputs que el servidor aún no confirmó.
    for (const input of this.pendingInputs) {
      this._applyLocalPrediction(input, this.PREDICTION_DT, Date.now());
    }

    const correctionDistance = previous
      ? Math.hypot(serverPlayer.x - previous.x, serverPlayer.y - previous.y)
      : Infinity;
    this.renderer.reconcileLocalState(
      this.predictedLocalState,
      correctionDistance <= 80
    );
  }

  _applyLocalPrediction(input, dt, now) {
    const p = this.predictedLocalState;
    if (!p || !p.alive) return;

    const dx = Number(input.dx) || 0;
    const dy = Number(input.dy) || 0;
    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    const classSpeed = { scout: 1.4, tank: 0.7, runner: 1.2, brawler: 1.0 }[p.botClass] || 1;
    const pushMult = { scout: 0.8, tank: 1.5, runner: 0.9, brawler: 1.2 }[p.botClass] || 1.2;
    const speedBoost = p.hasSpeed ? 1.6 : 1;
    const boostMult = p.inBoostZone ? 1.35 : 1;
    const speed = 220 * classSpeed * speedBoost * boostMult;

    if (dx !== 0 || dy !== 0) {
      const dirX = dx / length;
      const dirY = dy / length;
      p.vx = (p.vx || 0) + dirX * speed * dt * 8;
      p.vy = (p.vy || 0) + dirY * speed * dt * 8;
      const velocity = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (velocity > speed) {
        p.vx = p.vx / velocity * speed;
        p.vy = p.vy / velocity * speed;
      }
      p.angle = Math.atan2(dirY, dirX);
    } else {
      p.vx = (p.vx || 0) * 0.88;
      p.vy = (p.vy || 0) * 0.88;
    }

    if (input.action && now >= this.predictedSpecialReadyAt) {
      const angle = Number.isFinite(p.angle) ? p.angle : 0;
      p.vx += Math.cos(angle) * 480 * pushMult;
      p.vy += Math.sin(angle) * 480 * pushMult;
      this.predictedSpecialReadyAt = now + 5000;
    }

    p.x += (p.vx || 0) * dt;
    p.y += (p.vy || 0) * dt;
    p.vx *= 0.92;
    p.vy *= 0.92;
  }

  // ─── HUD ────────────────────────────────────────────────────────────────

  _updateHUD(state) {
    const alive = state.players.filter(p => p.alive).length;
    if (this.hudAlive) this.hudAlive.textContent = alive;

    const local = state.players.find(p => p.id === this.localPlayerId);
    if (!local) return;

    const pct = local.specialCooldownPct ?? 1;
    if (this.specialBarFill) {
      this.specialBarFill.style.width   = `${pct * 100}%`;
      this.specialBarFill.style.opacity = pct >= 1 ? '1' : '0.55';
    }
    if (this.cooldownRing) this.cooldownRing.style.strokeDashoffset = 113 * (1 - pct);
    const glow = document.getElementById("special-ready-glow");
    if (glow) glow.classList.toggle("visible", pct >= 1);

    if (this.effectIndicators) {
      const chips = [];
      if (local.hasSpeed)  chips.push({ label: '⚡ VELOZ',   color: '#00ff88' });
      if (local.hasShield) chips.push({ label: '🛡 ESCUDO',  color: '#4488ff' });
      if (local.isBig)     chips.push({ label: '💥 GIGANTE', color: '#ff4444' });
      this.effectIndicators.innerHTML = chips.map(c =>
        `<div class="effect-chip" style="color:${c.color};border-color:${c.color}44">${c.label}</div>`
      ).join('');
    }
  }

  _updateAliveCount(count) { if (this.hudAlive) this.hudAlive.textContent = count; }

  _onLocalEliminated() {
    this.renderer.cycleSpectatorTarget();
    toast('👁 TAB → cambiar espectador', 'info');
  }

  _startPing() {
    this.pingInterval = setInterval(() => {
      if (this.socket?.connected) this.socket.emit('ping_check', Date.now());
    }, 2000);
  }

  // ─── API pública ────────────────────────────────────────────────────────
  createRoom(nickname, skin, roomName, maxPlayers) { this.socket.emit('create_room', { nickname, skin, roomName, maxPlayers }); }
  joinRoom(nickname, skin, roomId)                  { this.socket.emit('join_room',   { nickname, skin, roomId }); }
  startGame()                                        { this.socket.emit('start_game'); }
  sendChat(message)                                  { this.socket.emit('chat_message', message); }
  cleanup() { this._stopGameLoop(); clearInterval(this.pingInterval); audio.stopMusic(); }
}
