---
name: debug-game
description: "Diagnostica problemas de ejecución del servidor o la UI del juego. Usar ante errores 404, MIME, CSP, socket o crashes."
triggers: [error, 404, falla, crash, no conecta, no carga, socket, MIME, CSP, bug, debug]
---

## Objetivo
Identificar la causa raíz del error en ≤3 pasos y proponer el fix mínimo.

## Pasos
1. Clasificar el error:
   - **404 en recurso estático** → verificar que `express.static` apunte a la raíz correcta y que el archivo exista
   - **MIME type incorrecto** → el archivo no existe y el servidor devuelve `index.html` como fallback
   - **CSP bloqueado** → revisar cabecera `Content-Security-Policy` en `server.js`
   - **Socket no conecta** → verificar `SERVER_URL` en `main.js` y que el puerto coincida
   - **Crash de Node** → leer el stack trace completo; buscar `Cannot find module` o `EADDRINUSE`
2. Aplicar fix mínimo al archivo afectado
3. Reiniciar servidor con `$env:PORT=3002; node server.js`

## Output esperado
- Causa identificada en 1 oración
- Diff del fix
- Comando para verificar

## Notas de eficiencia
- `EADDRINUSE` → matar proceso con `Stop-Process -Id $(Get-NetTCPConnection -LocalPort XXXX).OwningProcess`
- Nunca mover lógica anti-cheat (`handleInput`) al cliente para "arreglar" un bug de rendimiento
