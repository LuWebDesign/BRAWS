# BrawlBots — Copilot Instructions

Juego de arena battle multijugador en tiempo real. Stack: **Node.js + Socket.io + Canvas 2D + better-sqlite3**.

## Arquitectura

Modelo **servidor autoritativo** — el servidor es la única fuente de verdad. El cliente solo interpolea y renderiza.

| Capa | Archivo | Responsabilidad |
|------|---------|-----------------|
| HTTP / WS | `server.js` | Express + Socket.io, rooms, host migration, REST API |
| Game loop | `gameRoom.js` | Estado de juego, física, colisiones, power-ups, bots |
| Bot IA | `botAI.js` | Máquina de estados HUNT/FLEE/GRAB/DODGE a 180 ms |
| Persistencia | `db.js` | SQLite: leaderboard, historial de partidas (opcional) |
| Render client | `renderer.js` | Canvas 2D, interpolación, cámara, partículas |
| Estado client | `game.js` | Socket.io client, game loop RAF, HUD, espectador |
| UI | `ui.js` | Pantallas, lobby, chat, kill feed, countdown |
| Entry point | `main.js` | Bindings iniciales de UI |

> Todos los archivos viven en la raíz del proyecto (**estructura plana**). El README describe una estructura `server/`/`client/` que ya no refleja el estado real.

## Build y ejecución

```bash
npm install        # instala dependencias (better-sqlite3 es opcional)
npm run dev        # servidor con auto-restart (nodemon)
npm start          # producción
```

Abrir `index.html` directamente en el navegador, o:`npx serve . -p 8080`

Para probar multijugador: **abrir 2+ pestañas** en el mismo navegador.

## Convenciones clave

### Servidor

- **TICK_RATE = 60 Hz** — El loop de `gameRoom.js` corre a 16.67 ms. No cambiar sin ajustar física y delta compression.
- **Delta compression** — `broadcastState()` solo envía propiedades que cambiaron respecto al último estado (`_lastBroadcast` por socket).
- **Anti-cheat** — `handleInput()` limita a ~125 inputs/s. >15 warnings = kick automático. No mover esta lógica al cliente.
- **Killer credit window = 3000 ms** — Un empuje cuenta como eliminación hasta 3 s después del impacto.
- **Host migration** — Si el host se desconecta, el servidor asigna automáticamente un nuevo host.

### Base de datos

- `db.js` falla silenciosamente si `better-sqlite3` no está instalado — el juego continúa sin persistencia. Siempre verificar con `if (db)` antes de consultar.
- Los bots no se guardan en el leaderboard (filtro por prefijo `[BOT]`).

### Cliente

- **Interpolación en 100 ms** — `renderer.js` mantiene un buffer de 100 ms para suavizar el estado del servidor. Los efectos visuales usan `lerp` entre `prevX/Y` y `targetX/Y`.
- **Input a 60 Hz** — `game.js` envía inputs al servidor cada `1000/60` ms via `requestAnimationFrame`.
- **Detección de colisión local** — El cliente detecta deltas de velocidad >130 px/s para disparar audio y screen shake sin esperar al servidor.

### Bot IA

- Intervalo de decisión: **180 ms** (no por tick). Las decisiones se re-evalúan en `_evaluate()`.
- Prioridad de estados: `FLEE > DODGE > GRAB > HUNT`.
- `DIFFICULTY = 0.72` — Controla cuánto ruido (movimiento orgánico) aplica el bot.

## Eventos Socket.io principales

| Dirección | Evento | Propósito |
|-----------|--------|-----------|
| C → S | `create_room`, `join_room` | Gestión de salas |
| C → S | `player_input` | Input {dx, dy, action} a 60 Hz |
| S → C | `game_state` | Estado completo/delta a 60 Hz |
| S → C | `player_eliminated` | Notificación de eliminación |
| S → C | `game_over` | Resultado final con stats |

## Puntos de extensión comunes

- **Nuevo tipo de bot**: añadir clase en `botAI.js` y registrar en `BOT_CLASSES` en `gameRoom.js`.
- **Nuevo mapa**: añadir entrada en el objeto `MAPS` de `gameRoom.js` con `obstacles` y `boostZones`.
- **Nuevo power-up**: añadir en el enum de tipos de `gameRoom.js` y manejar en `activateSpecial()`.
- **Nueva pantalla**: añadir `<section id="screen-X">` en `index.html` y registrar en `UI.showScreen()`.
