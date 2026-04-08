---
name: add-bot-type
description: "Añade un nuevo tipo de bot al juego. Usar cuando el usuario pide crear una clase de bot con stats o comportamiento nuevo."
triggers: [nuevo bot, añadir bot, crear bot, clase de bot, bot type]
---

## Objetivo
Registrar un nuevo tipo de bot en `botAI.js` y `gameRoom.js` sin romper el loop de 60 Hz ni el anti-cheat.

## Pasos
1. En `botAI.js`: añadir entrada en el objeto `BOT_CLASSES` con `{ speed, radius, pushForce, color }`
2. En `gameRoom.js`: registrar la clase en `BOT_CLASSES` local y definir sus multiplicadores de stats
3. Verificar que `DIFFICULTY = 0.72` y `DECISION_INTERVAL = 180 ms` aplican al nuevo bot sin cambios
4. Opcional: añadir nombre de bot en el array `BOT_NAMES` de `botAI.js`

## Output esperado
- Diff mínimo en `botAI.js` y `gameRoom.js`
- El bot aparece seleccionable en el lobby (si se expone en la UI)

## Notas de eficiencia
- No tocar `_evaluate()` ni `_executeState()` salvo que la skill del bot sea completamente distinta
- Prioridad de estados es siempre `FLEE > DODGE > GRAB > HUNT` — no cambiar el orden
