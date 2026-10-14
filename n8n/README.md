# bandadau-infra/n8n/

Workflows de n8n versionados como JSON (fuente de verdad): bienvenida, recordatorio de eventos,
escalamiento de moderación, resumen semanal generativo, alerta crítica y difusión de eventos, todos
detrás del router `wf-00-router` (D15).

```bash
# desde bandadau-infra/
make infra-up                    # n8n en http://localhost:5678
./n8n/scripts/import.sh          # cargar workflows
./n8n/scripts/export.sh          # exportar tras editar en la UI
node n8n/scripts/validate.mjs    # validación (CI)
```

Credenciales solo por variables de entorno (`.env.example`). Disparadores: cola RabbitMQ
`n8n.automation` y crons en `America/La_Paz`. Reglas: **[`AGENTS.md`](AGENTS.md)**;
diseño: `bandadau-docs/docs/03-arquitectura/decisiones-clave.md` (D10).
