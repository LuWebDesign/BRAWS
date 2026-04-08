---
name: add-screen
description: "Añade una nueva pantalla a la UI del juego. Usar cuando el usuario pide una vista nueva (estadísticas, créditos, configuración, etc.)."
triggers: [nueva pantalla, nueva vista, nueva sección, nuevo screen, añadir página]
---

## Objetivo
Registrar la pantalla en `index.html` y en `UI.showScreen()` sin romper el flujo de navegación existente.

## Pasos
1. En `index.html`: añadir `<div id="screen-X" class="screen">...</div>` antes del cierre de `</body>`
2. En `ui.js`: `UI.showScreen('screen-X')` funciona automáticamente (usa querySelectorAll)
3. Añadir botón de acceso desde otra pantalla y su `addEventListener` en `main.js`
4. Si la pantalla necesita datos del servidor: añadir `fetch(SERVER_URL + '/api/...')` en `main.js`

## Output esperado
- Bloque HTML de la nueva pantalla
- Bindings de navegación en `main.js`

## Notas de eficiencia
- No duplicar lógica de CSS — reusar clases `.screen`, `.screen-header`, `.card`
- `UI.showScreen()` ya maneja el toggle de `.active` — no añadir lógica de display manual
