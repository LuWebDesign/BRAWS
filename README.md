# 🤖 BRAWLBOTS v3

Juego de arena battle multijugador online.  
**Stack:** Node.js · Socket.io · Canvas 2D · SQLite

---

## 🚀 Setup rápido

```bash
cd server
npm install
npm run dev          # dev con auto-restart
# npm start          # producción
```

Abrir `client/index.html` en el navegador  
(o `npx serve client -p 8080` para servidor HTTP local).

Probar multijugador: abrir **2+ pestañas** en el mismo navegador.

---

## 📁 Estructura

```
brawlbots/
├── server/
│   ├── server.js      ← Express + Socket.io, API REST, cleanup
│   ├── gameRoom.js    ← Game loop 60Hz, física, bots, delta compression
│   ├── botAI.js       ← IA de bots (HUNT / FLEE / GRAB / DODGE)
│   ├── db.js          ← SQLite: leaderboard, historial de partidas
│   └── package.json
│
└── client/
    ├── index.html     ← 6 pantallas (home, rooms, lobby, game, gameover, leaderboard)
    ├── css/style.css  ← UI cyberpunk dark
    └── js/
        ├── audio.js   ← Web Audio API procedural (sin archivos externos)
        ├── renderer.js← Canvas 2D: arena, bots, obstáculos, boost zones, FX
        ├── input.js   ← WASD + joystick virtual mobile
        ├── game.js    ← Socket.io client, game loop, HUD, espectador
        ├── ui.js      ← Pantallas, lobby, chat, kill feed, leaderboard
        ├── main.js    ← Entry point, bindings de UI
        └── utils.js   ← Helpers
```

---

## 🎮 Controles

| Acción           | PC                | Mobile              |
|------------------|-------------------|---------------------|
| Mover            | WASD / Flechas    | Joystick izquierdo  |
| Especial (dash)  | ESPACIO           | Botón 💥 derecho    |
| Cambiar espectador| TAB (al morir)   | —                   |
| Toggle música    | M                 | —                   |
| Settings audio   | ESC               | Botón 🔊 en HUD     |

---

## 🧠 Clases de bot

| Clase   | Velocidad | Tamaño | Empuje | Rol                |
|---------|-----------|--------|--------|--------------------|
| Brawler | ●●●       | ●●●    | ●●●●   | Equilibrado        |
| Scout   | ●●●●●     | ●●     | ●●     | Hit & run          |
| Tank    | ●●        | ●●●●●  | ●●●●●  | Empujador pesado   |
| Runner  | ●●●●      | ●●●    | ●●●    | Ágil y escurridizo |

---

## 🗺️ Mapas

| Mapa            | Obstáculos | Boost Zones | Descripción                        |
|-----------------|------------|-------------|------------------------------------|
| Arena Circular  | ✗          | 4 (cruz)    | Limpio, ideal para aprender        |
| Pilares         | 5 pilares  | 2 laterales | Control de espacios                |
| Cruz            | 5 pilares  | 4 esquinas  | Caótico, muchos rebotes            |

---

## 💊 Power-ups

| Ítem        | Duración | Efecto                        |
|-------------|----------|-------------------------------|
| ⚡ Velocidad | 4s       | +60% velocidad de movimiento  |
| 🛡 Escudo   | 5s       | Absorbe empujes (inmune)      |
| 💥 Gigante  | 3s       | +30% tamaño y fuerza de empuje|

---

## 🤖 Bot IA

Los bots se agregan automáticamente cuando hay menos de 2 jugadores.  
Estados de comportamiento:

- **HUNT** — persigue al jugador más vulnerable (cerca del borde)
- **FLEE** — se aleja del borde cuando está en peligro  
- **GRAB** — va a buscar el power-up más cercano  
- **DODGE** — evade a enemigos que vienen rápido

Dificultad configurable en `botAI.js` → constante `DIFFICULTY` (0–1).

---

## 🔒 Anti-cheat

- **Input rate limiting:** >125 inputs/s genera warnings; 15 warnings → input ignorado
- **Valor clamping:** dx/dy forzados entre -1 y 1 en el servidor
- **Servidor autoritativo:** toda la física corre en el servidor, el cliente solo renderiza

---

## 🏆 API REST

```
GET /api/rooms          → Salas públicas en lobby
GET /api/leaderboard    → Top 25 jugadores (requiere better-sqlite3)
GET /api/player/:nick   → Stats individuales
GET /api/matches        → Últimas 10 partidas
```

---

## 🚀 Deploy

### Railway (recomendado)
```bash
# 1. Subir repo a GitHub
# 2. Conectar en railway.app → New Project → Deploy from GitHub
# 3. Variables de entorno: PORT=3001
# El cliente se sirve desde Express (express.static)
```

### Separado (Vercel frontend + Railway backend)
Cambiar en `main.js`:
```js
const SERVER_URL = 'https://tu-backend.railway.app';
```

---

## 📈 Escalar

| Escala       | Solución                                          |
|--------------|---------------------------------------------------|
| ~50 rooms    | Esta arquitectura, proceso único                  |
| ~200 rooms   | `cluster` + Redis adapter para Socket.io          |
| ~1000+ rooms | Microservicios: lobby server + N game servers     |
| Global       | Regiones geográficas + UDP via WebRTC DataChannels|

---

## 📦 Dependencias

```json
{
  "express":        "HTTP + static files",
  "socket.io":      "WebSockets multiplayer",
  "cors":           "CORS para desarrollo",
  "better-sqlite3": "Persistencia (opcional — graceful degradation)"
}
```
