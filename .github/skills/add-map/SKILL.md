---
name: add-map
description: "Crea un nuevo mapa de arena. Usar cuando el usuario pide un nuevo escenario con obstáculos o boost zones."
triggers: [nuevo mapa, añadir mapa, crear mapa, escenario, arena, obstacles, boost zones]
---

## Objetivo
Añadir una entrada en el objeto `MAPS` de `gameRoom.js` con geometría de obstáculos y boost zones.

## Pasos
1. En `gameRoom.js`, localizar el objeto `MAPS`
2. Añadir nueva clave con estructura:
   ```js
   key: {
     name: 'Nombre legible',
     obstacles:  [{ x, y, radius }],   // círculos estáticos
     boostZones: [{ x, y, radius, factor, color }]
   }
   ```
3. Verificar que ningún obstáculo tenga `radius` > 80 (rompe pathfinding de bots)
4. Coordenadas relativas a centro de arena `(0,0)`; `ARENA_RADIUS = 380`

## Output esperado
- Un bloque de código listo para pegar en `MAPS`
- Comentario con descripción del layout

## Notas de eficiencia
- `factor` en boost zones: 1.5–2.5 recomendado. >3 rompe física
- No modificar `TICK_RATE` ni `ARENA_RADIUS`
