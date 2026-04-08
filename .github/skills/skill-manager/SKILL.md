---
name: skill-manager
description: "Meta-skill que analiza tareas, detecta la skill adecuada del repositorio y la ejecuta. Usar cuando no está claro qué skill aplicar o al recibir una tarea nueva."
triggers: [skill manager, qué skill usar, nueva tarea, gestionar skills, repositorio de skills]
---

## Objetivo
Minimizar consumo de tokens ejecutando solo la skill necesaria para cada tarea. Nunca cargar skills innecesarias.

## Pasos
1. Leer el índice en `.github/skills/INDEX.md`
2. Evaluar si existe skill exacta (≥80% cobertura) → ejecutar directamente
3. Si hay skill parcial → adaptarla y ejecutar
4. Si no existe → crear nueva skill con plantilla mínima, agregarla al INDEX, luego ejecutar

## Output esperado
- Declaración explícita: "Usando Skill: `[nombre]`" antes de ejecutar
- Si se crea skill nueva: archivo `.github/skills/<nombre>/SKILL.md` + fila actualizada en INDEX

## Notas de eficiencia
- Cargar solo la skill activa, nunca todo el repositorio
- Si la tarea tiene múltiples etapas → declarar "Usando Skill A + Skill B"
- Una skill = una responsabilidad. Si supera 50 líneas → dividir
