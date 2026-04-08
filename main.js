/**
 * main.js — Punto de entrada. Conecta todos los eventos de UI.
 */

const SERVER_URL = window.location.origin;

const game = new Game();
game.connect(SERVER_URL);

// ── Partículas de fondo ───────────────────────────────────────────────────────
function createParticles() {
  const container = document.getElementById('particles');
  if (!container) return;
  const colors = ['#00c8ff','#cc44ff','#00ff88','#ff6644','#ffdd00'];
  for (let i = 0; i < 35; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.cssText = `
      left:${Math.random()*100}%;
      animation-duration:${4+Math.random()*9}s;
      animation-delay:${Math.random()*9}s;
      width:${1+Math.random()*3}px;
      height:${1+Math.random()*3}px;
      background:${colors[Math.floor(Math.random()*colors.length)]};
    `;
    container.appendChild(p);
  }
}
createParticles();

// ── Selector de bot class y color ─────────────────────────────────────────────
document.querySelectorAll('.bot-class').forEach(el =>
  el.addEventListener('click', () => {
    document.querySelectorAll('.bot-class').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
  })
);
document.querySelectorAll('.color-swatch').forEach(el =>
  el.addEventListener('click', () => {
    document.querySelectorAll('.color-swatch').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
  })
);

// ── Crear sala ────────────────────────────────────────────────────────────────
document.getElementById('btn-create').addEventListener('click', () => {
  const { nickname, skin } = getPlayerConfig();
  if (!nickname) { toast('Ingresá un nickname', 'error'); document.getElementById('nickname-input').focus(); return; }
  game.createRoom(nickname, skin, `Sala de ${nickname}`, 4);
});

document.getElementById('nickname-input').addEventListener('keypress', e => {
  if (e.key === 'Enter') document.getElementById('btn-create').click();
});

// ── Ver salas ─────────────────────────────────────────────────────────────────
document.getElementById('btn-join-list').addEventListener('click', () => {
  const { nickname } = getPlayerConfig();
  if (!nickname) { toast('Ingresá un nickname primero', 'error'); document.getElementById('nickname-input').focus(); return; }
  UI.showScreen('screen-rooms');
  fetchRooms();
});

document.getElementById('btn-back-rooms').addEventListener('click', () => UI.showScreen('screen-home'));
document.getElementById('btn-refresh-rooms').addEventListener('click', fetchRooms);

function fetchRooms() {
  fetch(`${SERVER_URL}/api/rooms`)
    .then(r => r.json()).then(rooms => UI.updateRoomsList(rooms))
    .catch(() => toast('Error al cargar salas', 'error'));
}

// ── Unirse con código ─────────────────────────────────────────────────────────
document.getElementById('btn-join-code').addEventListener('click', joinWithCode);
document.getElementById('room-code-input').addEventListener('keypress', e => {
  if (e.key === 'Enter') joinWithCode();
});

function joinWithCode() {
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (!code || code.length !== 6) { toast('Código inválido (6 caracteres)', 'error'); return; }
  const { nickname, skin } = getPlayerConfig();
  if (!nickname) { UI.showScreen('screen-home'); toast('Ingresá un nickname primero', 'error'); return; }
  game.joinRoom(nickname, skin, code);
}

// ── Copiar código de sala ─────────────────────────────────────────────────────
document.getElementById('btn-copy-code').addEventListener('click', () => {
  const code = document.getElementById('lobby-room-code').textContent;
  navigator.clipboard?.writeText(code)
    .then(() => toast(`Código ${code} copiado 📋`, 'success'))
    .catch(() => toast(`Código: ${code}`, 'info'));
});

// ── Salir del lobby ───────────────────────────────────────────────────────────
document.getElementById('btn-back-lobby').addEventListener('click', () => {
  // Desconectar de la sala y volver al home
  game.roomId = null;
  UI.showScreen('screen-home');
  // No podemos salir de la sala sin desconectar el socket en esta versión MVP,
  // así que reconectamos para obtener un nuevo id limpio
  game.socket?.disconnect();
  game.socket?.connect();
});

// ── Iniciar partida ───────────────────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', () => game.startGame());

// ── Chat en lobby ─────────────────────────────────────────────────────────────
document.getElementById('btn-send-chat').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keypress', e => {
  if (e.key === 'Enter') sendChat();
});

function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  game.sendChat(msg);
  input.value = '';
}

// ── Botones de game over ──────────────────────────────────────────────────────
document.getElementById('btn-play-again').addEventListener('click', () => {
  if (game.roomId) UI.showScreen('screen-lobby');
  else UI.showScreen('screen-home');
});
document.getElementById('btn-back-home').addEventListener('click', () => {
  game.roomId = null; game.gameActive = false;
  UI.showScreen('screen-home');
});

// ── Settings de audio ─────────────────────────────────────────────────────────
document.getElementById('btn-settings-home').addEventListener('click', () => UI.showSettings());
document.getElementById('modal-close').addEventListener('click', () => UI.hideSettings());
document.getElementById('modal-backdrop').addEventListener('click', () => UI.hideSettings());
document.getElementById('btn-audio-toggle')?.addEventListener('click', () => UI.showSettings());

document.getElementById('toggle-sfx').addEventListener('click', function() {
  const on = audio.toggleSFX();
  this.textContent = on ? 'ON' : 'OFF';
  this.classList.toggle('active', on);
});
document.getElementById('toggle-music').addEventListener('click', function() {
  const on = audio.toggleMusic();
  this.textContent = on ? 'ON' : 'OFF';
  this.classList.toggle('active', on);
});
document.getElementById('vol-sfx').addEventListener('input', function() {
  audio.setSFXVolume(this.value / 100);
});
document.getElementById('vol-music').addEventListener('input', function() {
  audio.setMusicVolume(this.value / 100);
});

// ── Teclado durante el juego ──────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (!game.gameActive) return;

  // TAB → ciclar espectador
  if (e.key === 'Tab') {
    e.preventDefault();
    if (!game.isAlive) game.renderer.cycleSpectatorTarget();
  }

  // ESC → settings
  if (e.key === 'Escape') UI.showSettings();

  // M → toggle música
  if (e.key === 'm' || e.key === 'M') {
    const on = audio.toggleMusic();
    toast(on ? '🎵 Música ON' : '🔇 Música OFF', 'info');
  }
});

// ── Detectar mobile ───────────────────────────────────────────────────────────
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 0;
document.getElementById('mobile-controls').style.display = isMobile ? 'flex' : 'none';
document.getElementById('special-bar-pc').style.display  = isMobile ? 'none'  : 'flex';

// ── Anti double-tap zoom (mobile) ─────────────────────────────────────────────
document.addEventListener('touchstart', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
let _lastTap = 0;
document.addEventListener('touchend', e => {
  const now = Date.now();
  if (now - _lastTap < 300) e.preventDefault();
  _lastTap = now;
}, { passive: false });

// ── Pausar input al minimizar ─────────────────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.gameActive && game.isAlive) {
    game.socket?.emit('player_input', { dx:0, dy:0, action:false, timestamp: Date.now() });
  }
});

// ── CSS slot vacío extra ──────────────────────────────────────────────────────
// (lo inyectamos en JS para no tocar style.css otra vez)
const _style = document.createElement('style');
_style.textContent = `
  .player-card-empty {
    opacity: 0.35;
    border-style: dashed !important;
    cursor: default;
  }
  .empty-slot-icon {
    font-size: 22px;
    color: var(--text-dim);
    line-height: 1;
  }
`;
document.head.appendChild(_style);

console.log('🤖 BRAWLBOTS Client v2 iniciado →', SERVER_URL);

// ── Leaderboard ───────────────────────────────────────────────────────────────
document.getElementById('btn-leaderboard')?.addEventListener('click', () => {
  UI.showScreen('screen-leaderboard');
  loadLeaderboard();
});

document.getElementById('btn-back-leaderboard')?.addEventListener('click', () => {
  UI.showScreen('screen-home');
});

document.getElementById('btn-refresh-lb')?.addEventListener('click', loadLeaderboard);

function loadLeaderboard() {
  const body = document.getElementById('leaderboard-body');
  if (body) body.innerHTML = '<div class="empty-state">Cargando...</div>';
  fetch(`${SERVER_URL}/api/leaderboard`)
    .then(r => r.json())
    .then(data => UI.showLeaderboard(data))
    .catch(() => {
      if (body) body.innerHTML = '<div class="empty-state">Error al cargar ranking. ¿El servidor tiene better-sqlite3?</div>';
    });
}
