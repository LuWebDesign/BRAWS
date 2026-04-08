---
name: add-powerup
description: "Añade un nuevo tipo de power-up al juego. Usar cuando el usuario pide un efecto temporal para los jugadores."
triggers: [nuevo power-up, powerup, efecto temporal, añadir power, speed boost, item]
---

## Objetivo
Registrar el power-up en el enum de tipos de `gameRoom.js` y manejarlo en `activateSpecial()` y el renderer.

## Pasos
1. En `gameRoom.js`: añadir la clave al enum de tipos de power-up
2. En `gameRoom.js → activateSpecial()`: añadir `case` con la lógica del efecto (duración en ms, multiplicadores)
3. En `game.js → _bindSocketEvents()`: añadir sonido en `powerup_collected` si el tipo es nuevo
4. En `renderer.js`: añadir color/icono del power-up en el mapa visual si existe

## Output esperado
- Diff en `gameRoom.js` (enum + case en activateSpecial)
- Diff opcional en `game.js` y `renderer.js` para feedback visual/audio

## Notas de eficiencia
- Duración máxima recomendada: 8000 ms (>10 s rompe balance)
- Los efectos se resetean en `removePlayer()` — verificar que el nuevo efecto tenga cleanup
