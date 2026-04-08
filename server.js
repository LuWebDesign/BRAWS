/**
 * BRAWLBOTS - Game Server v2
 * Node.js + Socket.io — autoritativo, anti-cheat, leaderboard, bots IA
 */

const express   = require('express');
const path      = require('path');
const http      = require('http');
const { Server }= require('socket.io');
const cors      = require('cors');
const { GameRoom }         = require('./gameRoom');
const { initDB, getLeaderboard, getPlayerStats, getRecentMatches } = require('./db');

const app = express();
app.use(cors());
// Servir archivos estáticos desde la raíz del proyecto (index.html está en la raíz)
app.use(express.static(path.join(__dirname, '.')));
app.use(express.json());

// CSP permisiva para desarrollo: permite conexiones desde el mismo origen
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' 'unsafe-inline' data:; connect-src 'self' ws: http: https:; img-src 'self' data:;"
  );
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] },
  pingInterval: 2000,
  pingTimeout:  5000
});

// ─── Base de datos ────────────────────────────────────────────────────────────
initDB();

// ─── Estado global ────────────────────────────────────────────────────────────
const rooms      = new Map();   // roomId → GameRoom
const playerRoom = new Map();   // socketId → roomId

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getPublicRooms() {
  return [...rooms.values()]
    .filter(r => !r.isPrivate && r.state === 'lobby')
    .map(r => ({
      id:         r.id,
      name:       r.name,
      players:    r.players.size,
      maxPlayers: r.maxPlayers,
      host:       r.hostName,
      mapName:    r.map?.name || ''
    }));
}

// ─── Limpieza periódica de salas vacías ───────────────────────────────────────
setInterval(() => {
  for (const [id, room] of rooms) {
    // Sala vacía de humanos
    const humans = [...room.players.values()].filter(p => !p.isBot).length;
    if (humans === 0) {
      room.destroy();
      rooms.delete(id);
      io.emit('rooms_updated', getPublicRooms());
      console.log(`[CLEANUP] Sala ${id} eliminada (sin humanos)`);
    }
  }
}, 30_000);

// ─── HTTP API ─────────────────────────────────────────────────────────────────

app.get('/api/rooms', (_, res) => res.json(getPublicRooms()));

app.get('/api/leaderboard', (_, res) => {
  const data = getLeaderboard(25);
  res.json(data);
});

app.get('/api/player/:nickname', (req, res) => {
  const stats = getPlayerStats(req.params.nickname);
  if (!stats) return res.status(404).json({ error: 'Jugador no encontrado' });
  res.json(stats);
});

app.get('/api/matches', (_, res) => {
  res.json(getRecentMatches(10));
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} conectado`);

  // ── Crear sala ──────────────────────────────────────────────────────────────
  socket.on('create_room', ({ nickname, skin, roomName, maxPlayers, isPrivate }) => {
    if (!nickname?.trim()) return;

    const roomId = generateRoomId();
    const room   = new GameRoom(roomId, {
      name:       (roomName || `Sala de ${nickname}`).slice(0, 30),
      maxPlayers: Math.min(Math.max(maxPlayers || 4, 2), 6),
      isPrivate:  !!isPrivate,
      hostId:     socket.id,
      hostName:   nickname,
      io
    });

    rooms.set(roomId, room);
    playerRoom.set(socket.id, roomId);
    room.addPlayer(socket, { nickname, skin });
    socket.join(roomId);

    socket.emit('room_created', { roomId, room: room.getPublicState() });
    io.emit('rooms_updated', getPublicRooms());
    console.log(`[ROOM] ${roomId} creada por ${nickname}`);
  });

  // ── Unirse a sala ───────────────────────────────────────────────────────────
  socket.on('join_room', ({ nickname, skin, roomId }) => {
    if (!nickname?.trim()) return;
    const room = rooms.get(roomId);

    if (!room)                           return socket.emit('error', { message: 'Sala no encontrada' });
    if (room.state !== 'lobby')          return socket.emit('error', { message: 'La partida ya comenzó' });
    if (room.players.size >= room.maxPlayers) return socket.emit('error', { message: 'Sala llena' });

    playerRoom.set(socket.id, roomId);
    room.addPlayer(socket, { nickname, skin });
    socket.join(roomId);

    socket.emit('room_joined', { roomId, room: room.getPublicState() });
    io.to(roomId).emit('player_joined', { room: room.getPublicState() });
    io.emit('rooms_updated', getPublicRooms());
    console.log(`[ROOM] ${nickname} se unió a ${roomId}`);
  });

  // ── Input (rate-limited + validado en GameRoom) ─────────────────────────────
  socket.on('player_input', (input) => {
    const roomId = playerRoom.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room || room.state !== 'playing') return;
    room.handleInput(socket.id, { ...input, receivedAt: Date.now() });
  });

  // ── Iniciar partida ─────────────────────────────────────────────────────────
  socket.on('start_game', () => {
    const roomId = playerRoom.get(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room)                         return;
    if (room.hostId !== socket.id)     return socket.emit('error', { message: 'Solo el host puede iniciar' });
    if (room.state !== 'lobby')        return socket.emit('error', { message: 'Ya hay una partida en curso' });
    // Ahora se puede iniciar con 1 jugador (los bots completan)
    room.startCountdown();
  });

  // ── Chat ────────────────────────────────────────────────────────────────────
  socket.on('chat_message', (message) => {
    const roomId = playerRoom.get(socket.id);
    if (!roomId) return;
    rooms.get(roomId)?.addChatMessage(socket.id, message);
  });

  // ── Desconexión ─────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const roomId = playerRoom.get(socket.id);
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.removePlayer(socket.id);

        const humans = [...room.players.values()].filter(p => !p.isBot).length;
        if (humans === 0) {
          room.destroy();
          rooms.delete(roomId);
        } else {
          io.to(roomId).emit('player_left', { room: room.getPublicState() });

          // Nuevo host si se fue el anterior
          if (room.hostId === socket.id) {
            const next = [...room.players.values()].find(p => !p.isBot);
            if (next) {
              room.hostId   = next.id;
              room.hostName = next.nickname;
              io.to(roomId).emit('new_host', { hostId: next.id });
            }
          }
        }
      }
      playerRoom.delete(socket.id);
      io.emit('rooms_updated', getPublicRooms());
    }
    console.log(`[-] ${socket.id} desconectado`);
  });

  // ── Ping ────────────────────────────────────────────────────────────────────
  socket.on('ping_check', (ts) => socket.emit('pong_check', ts));
});

// ─── Arranque ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🤖 BRAWLBOTS Server v2 → http://localhost:${PORT}`);
  console.log(`   API: /api/rooms | /api/leaderboard | /api/matches\n`);
});
