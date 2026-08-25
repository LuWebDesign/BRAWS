# BRAWS

Juego de arena multijugador online ejecutado con Node.js, Socket.IO, Canvas 2D y SQLite.

> La imagen de referencia de BRAWS v4 es una dirección visual futura. El gameplay actual conserva la versión de arena con bots, empujes, obstáculos, boosts y powerups; la evolución hacia combate con armas/proyectiles se hará en fases posteriores.

## Requisitos

- Node.js 24 o compatible con las dependencias instaladas.
- npm.

## Instalación y arranque

```bash
npm install
npm run dev
```

El servidor queda disponible en:

```text
http://localhost:3001
```

Para producción:

```bash
npm start
```

`npm run dev` usa `node --watch` y reinicia el servidor cuando cambia un archivo JavaScript. No es necesario abrir el HTML con `file://` ni ejecutar un servidor frontend separado.

## Estructura actual

El repositorio utiliza una estructura plana en la raíz:

- `server.js`: Express, archivos estáticos, API REST y Socket.IO.
- `gameRoom.js`: salas, estado de partida, loop de simulación, física, colisiones, bots y powerups.
- `snapshotSystem.js`: serialización de snapshots completos para la red.
- `inputQueue.js`: validación, orden y acknowledgements de inputs recibidos.
- `botAI.js`: decisiones y movimiento de bots.
- `db.js`: persistencia SQLite del ranking e historial.
- `game.js`: conexión Socket.IO, eventos del cliente, HUD y loop de render.
- `renderer.js`: renderizado Canvas, cámara e interpolación visual básica.
- `input.js`: teclado, joystick mobile y habilidad especial.
- `ui.js`: lobby, chat, pantallas, ranking y resultados.
- `main.js`: composición y bindings de la interfaz.
- `audio.js`: audio procedural mediante Web Audio API.
- `utils.js`: utilidades compartidas del cliente.
- `index.html` y `css/style.css`: interfaz y estilos.

La documentación anterior que describía carpetas `server/` y `client/` estaba desactualizada.

## Funcionalidades actuales

- Salas públicas y privadas.
- Lobby, countdown y partidas multijugador.
- Servidor autoritativo para movimiento y colisiones.
- Bots con estados HUNT, FLEE, GRAB y DODGE.
- Tres mapas con obstáculos y boost zones.
- Powerups de velocidad, escudo y tamaño.
- Dash, muerte, espectador y condición de victoria.
- Chat de lobby.
- Ranking e historial persistidos en SQLite.
- UI responsive con controles mobile.

## API REST

- `GET /api/rooms`: salas públicas disponibles.
- `GET /api/leaderboard`: top 25.
- `GET /api/player/:nickname`: estadísticas de un jugador.
- `GET /api/matches`: últimas partidas.

## Scripts

- `npm run dev`: servidor con reinicio automático usando Node.
- `npm start`: servidor normal.
- `npm test`: ejecuta los tests Node disponibles.

## Estado del refactor BRAWS v4

La Fase 1 garantiza instalación y arranque confiables. Las fases siguientes separarán el loop de física del envío de snapshots, formalizarán el protocolo de inputs y agregarán prediction/reconciliation/interpolación de snapshots sin quitar la autoridad del servidor.
