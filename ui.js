/**
 * ui.js
 * Gestión de pantallas, lobby, chat, kill feed, game over y modal de settings.
 */

const UI = {

  // ── Pantallas ─────────────────────────────────────────────────────────────
  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
  },

  // ── Lobby ─────────────────────────────────────────────────────────────────
  showLobby(room, myId) {
    this.showScreen('screen-lobby');
    document.getElementById('lobby-room-code').textContent = room.id;
    const badge = document.getElementById('lobby-map-badge');
    if (badge) badge.textContent = `🗺 Mapa: ${room.mapName || '—'}`;
    this.updateLobby(room, myId);

    // Cargar historial de chat
    const chatEl = document.getElementById('chat-messages');
    if (chatEl) {
      chatEl.innerHTML = '';
      (room.chatHistory || []).forEach(msg => this.addChatMessage(msg, myId));
    }
  },

  updateLobby(room, myId) {
    const container = document.getElementById('lobby-players');
    container.innerHTML = '';

    const BOT_LABELS = { scout:'Scout', tank:'Tank', runner:'Runner', brawler:'Brawler' };

    for (const p of room.players) {
      const card = document.createElement('div');
      card.className = 'player-card';
      card.style.setProperty('--player-color', p.color);
      card.style.borderColor = p.color + '40';

      if (p.isHost || p.id === room.hostId) {
        const badge = document.createElement('div');
        badge.className = 'player-card-host';
        badge.textContent = 'HOST';
        card.appendChild(badge);
      }

      const botCanvas = document.createElement('canvas');
      botCanvas.className = 'player-card-bot';
      botCanvas.width = botCanvas.height = 52;

      card.innerHTML += `
        <div class="player-card-name">${escapeHtml(p.nickname)}</div>
        <div class="player-card-class">${BOT_LABELS[p.botClass] || 'Bot'}</div>
      `;
      card.insertBefore(botCanvas, card.children[card.children.length - 2] || card.firstChild);
      container.appendChild(card);
      drawMiniBot(botCanvas, p.color);
    }

    // Slots vacíos
    const empty = room.maxPlayers - room.players.length;
    for (let i = 0; i < empty; i++) {
      const slot = document.createElement('div');
      slot.className = 'player-card player-card-empty';
      slot.innerHTML = `<div class="empty-slot-icon">+</div><div class="player-card-class">Esperando...</div>`;
      container.appendChild(slot);
    }

    document.getElementById('lobby-count').textContent =
      `${room.players.length}/${room.maxPlayers} jugadores`;

    const btnStart = document.getElementById('btn-start');
    if (room.hostId === myId) {
      btnStart.disabled = room.players.length < 2;
      btnStart.textContent = room.players.length < 2 ? 'ESPERANDO JUGADORES...' : '⚡ INICIAR PARTIDA';
    } else {
      btnStart.disabled = true;
      btnStart.textContent = 'ESPERANDO AL HOST...';
    }
  },

  // ── Rooms list ────────────────────────────────────────────────────────────
  updateRoomsList(rooms) {
    const list = document.getElementById('rooms-list');
    if (!list) return;

    if (!rooms.length) {
      list.innerHTML = '<div class="empty-state">No hay salas. ¡Creá una!</div>';
      return;
    }

    list.innerHTML = rooms.map(r => `
      <div class="room-item" data-room-id="${r.id}">
        <div>
          <div class="room-item-name">${escapeHtml(r.name)}</div>
          <div class="room-item-info">Host: ${escapeHtml(r.host)}</div>
        </div>
        <div class="room-item-players">${r.players}/${r.maxPlayers} 👤</div>
      </div>
    `).join('');

    list.querySelectorAll('.room-item').forEach(item => {
      item.addEventListener('click', () => {
        const { nickname, skin } = getPlayerConfig();
        if (!nickname) { toast('Ingresá un nickname primero', 'error'); return; }
        game.joinRoom(nickname, skin, item.dataset.roomId);
      });
    });
  },

  // ── Chat ──────────────────────────────────────────────────────────────────
  addChatMessage(msg, myId) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `chat-msg${msg.playerId === myId ? ' is-local' : ''}`;
    el.innerHTML = `
      <span class="chat-nick" style="color:${msg.color}">${escapeHtml(msg.nickname)}:</span>
      <span class="chat-text">${escapeHtml(msg.text)}</span>
    `;
    container.appendChild(el);

    // Scroll al fondo
    container.scrollTop = container.scrollHeight;

    // Máx 80 mensajes en DOM
    while (container.children.length > 80) container.removeChild(container.firstChild);
  },

  addSystemChatMessage(text) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'chat-msg system';
    el.textContent = text;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  },

  // ── Kill Feed ─────────────────────────────────────────────────────────────
  addKillFeedEntry({ victim, killer, victimColor, isLocal }) {
    const feed = document.getElementById('kill-feed');
    if (!feed) return;

    const el = document.createElement('div');
    el.className = `kf-entry${isLocal ? ' kf-local' : ''}`;

    if (killer) {
      el.innerHTML = `
        <span class="kf-killer">${escapeHtml(killer)}</span>
        <span class="kf-arrow">💀</span>
        <span class="kf-victim" style="color:${victimColor}">${escapeHtml(victim)}</span>
      `;
    } else {
      el.innerHTML = `
        <span class="kf-victim" style="color:${victimColor}">${escapeHtml(victim)}</span>
        <span class="kf-arrow"> cayó</span>
      `;
    }

    feed.appendChild(el);

    // Auto-remover después de la animación (4s)
    setTimeout(() => {
      el.style.transition = 'opacity 0.4s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 400);
    }, 3600);

    // Máx 5 entradas
    while (feed.children.length > 5) feed.removeChild(feed.firstChild);
  },

  clearKillFeed() {
    const feed = document.getElementById('kill-feed');
    if (feed) feed.innerHTML = '';
  },

  // ── Countdown ─────────────────────────────────────────────────────────────
  showCountdown(count) {
    const overlay = document.getElementById('countdown-overlay');
    const num     = document.getElementById('countdown-number');
    overlay.classList.remove('hidden');
    num.textContent = count;
    num.style.animation = 'none';
    num.offsetHeight; // reflow
    num.style.animation = 'countdown-pop 0.5s ease';
    num.style.color = count === 1 ? '#ff6644' : 'var(--accent)';
    num.style.textShadow = count === 1
      ? '0 0 60px rgba(255,100,68,0.8)'
      : '0 0 60px rgba(0,200,255,0.8)';
  },

  hideCountdown() {
    setTimeout(() => document.getElementById('countdown-overlay')?.classList.add('hidden'), 900);
  },

  // ── Game Over ─────────────────────────────────────────────────────────────
  showGameOver(data, myId) {
    this.showScreen('screen-gameover');

    const isWinner = data.winner?.id === myId;
    document.getElementById('winner-crown').textContent  = data.winner ? '👑' : '🤝';
    document.getElementById('winner-name').textContent   = data.winner?.nickname || 'EMPATE';
    document.getElementById('winner-subtitle').textContent = isWinner ? '¡GANASTE! 🎉' : '¡VICTORIOSO!';

    if (data.winner) {
      document.getElementById('winner-name').style.color = data.winner.color;
    }

    const table = document.getElementById('results-table');
    const MEDALS = ['🥇','🥈','🥉'];
    table.innerHTML = data.results.map((p, i) => `
      <div class="result-row">
        <div class="result-rank ${i===0?'gold':''}">${MEDALS[i]||`#${i+1}`}</div>
        <div class="result-dot" style="background:${p.color};box-shadow:0 0 8px ${p.color}"></div>
        <div class="result-name">${escapeHtml(p.nickname)}${p.id===myId?' <small>(vos)</small>':''}</div>
        <div class="result-stat">💀 <span>${p.eliminations}</span></div>
        <div class="result-stat">⚡ <span>${p.pushCount}</span></div>
      </div>
    `).join('') + (data.duration
      ? `<div class="result-row" style="justify-content:center;opacity:0.4;font-size:11px">
           Duración: ${Math.round(data.duration/1000)}s
         </div>` : '');
  },

  // ── Modal settings ─────────────────────────────────────────────────────────
  showSettings() {
    document.getElementById('modal-settings')?.classList.remove('hidden');
  },
  hideSettings() {
    document.getElementById('modal-settings')?.classList.add('hidden');
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function drawMiniBot(canvas, color) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cx = w/2, cy = h/2, r = w*0.33;
  ctx.clearRect(0,0,w,h);
  ctx.shadowColor = color;
  ctx.shadowBlur  = 12;
  const g = ctx.createRadialGradient(cx-r*.3,cy-r*.3,0, cx,cy,r);
  g.addColorStop(0, lightenColor(color,40));
  g.addColorStop(1, darkenColor(color,20));
  ctx.beginPath();
  ctx.arc(cx,cy,r,0,Math.PI*2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle  = darkenColor(color,30);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(cx+r*.35, cy-r*.2, r*.7, r*.4, 2);
  else { ctx.rect(cx+r*.35, cy-r*.2, r*.7, r*.4); }
  ctx.fill();
}

function getPlayerConfig() {
  const nickname = document.getElementById('nickname-input')?.value?.trim() || '';
  const botClass = document.querySelector('.bot-class.active')?.dataset?.class || 'brawler';
  const color    = document.querySelector('.color-swatch.active')?.dataset?.color || '#cc44ff';
  return { nickname, skin: { botClass, color } };
}

function toast(message, type='info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Leaderboard ──────────────────────────────────────────────────────────────
UI.showLeaderboard = function(data) {
  this.showScreen('screen-leaderboard');
  const body = document.getElementById('leaderboard-body');
  if (!body) return;

  if (!data?.length) {
    body.innerHTML = '<div class="empty-state">Sin datos aún. ¡Jugá una partida!</div>';
    return;
  }

  const MEDALS = ['🥇','🥈','🥉'];
  const RANK_CLASS = ['gold','silver','bronze'];

  body.innerHTML = `
    <table class="lb-table">
      <thead>
        <tr>
          <th>#</th>
          <th>JUGADOR</th>
          <th style="text-align:right">VICTORIAS</th>
          <th style="text-align:right">ELIM.</th>
          <th style="text-align:right">% WIN</th>
        </tr>
      </thead>
      <tbody>
        ${data.map((p, i) => `
          <tr>
            <td class="lb-rank ${RANK_CLASS[i]||''}">${MEDALS[i] || `#${i+1}`}</td>
            <td class="lb-name">${escapeHtml(p.nickname)}</td>
            <td class="lb-stat">${p.wins}</td>
            <td class="lb-stat">${p.eliminations}</td>
            <td class="lb-wr">${p.win_rate}%</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div style="text-align:center;margin-top:16px;font-size:11px;opacity:0.4;font-family:var(--font-display);letter-spacing:2px">
      ${data.length} JUGADORES · ACTUALIZADO AUTOMÁTICAMENTE
    </div>
  `;
};
