# bandadau-infra/n8n/

Automatización (T10, D10/D15): workflows de n8n **versionados como JSON** (fuente de verdad). Imagen
`n8nio/n8n:2.43.5`, un solo contenedor con SQLite en el volumen `n8n-data`.
Diseño: `bandada-docs/docs/03-arquitectura/automatizacion-n8n.md`. Reglas: [`AGENTS.md`](AGENTS.md).

## Qué hay

| Workflow (`id`) | Disparador | Qué hace |
|---|---|---|
| `wf-00-router` (`wf00router`) | RabbitMQ Trigger sobre `n8n.automation` (único consumidor, D15) | Valida el CloudEvent y despacha por `type` al subflujo; `registration.confirmed.v1` y otros tipos son no-op |
| `wf-01-bienvenida` | `identity.user.registered.v1` | Dedupe por usuario → espera `N8N_WELCOME_DELAY` s (3600) → perfil + grupos sugeridos (social) → **email de bienvenida es/en** (SMTP) |
| `wf-02-recordatorio-evento` | Cron cada hora (min 0) + manual | Eventos `PUBLISHED` que empiezan en [ahora+23 h, ahora+25 h) → inscritos `CONFIRMED` → `EVENT_REMINDER` vía notification-service (`dedupeKey=reminder:<eventId>`) |
| `wf-03-escalamiento-moderacion` | `media.asset.flagged.v1` | `maxScore ≥ 0.95` o ≥ 3 marcas del autor en 24 h → email a moderadores (es/en) + `POST /internal/v1/alerts` (insights, tolera que no exista) |
| `wf-04-resumen-semanal` | Cron lunes 08:00 `America/La_Paz` + manual | Un reporte por idioma de admin (`POST /internal/v1/reports`), polling con `Wait` hasta `READY`/fallo, email con el markdown y **enlace al panel** (sin URL prefirmada); si falla, email de aviso |
| `wf-05-alerta-critica` | `insights.alert.raised.v1` | Solo `severity=CRITICAL`; dedupe `alertId+severity`; email a admins (+ Telegram si hay token) |
| `wf-06-difusion-evento` | `events.event.published.v1` | `NEW_EVENT` vía notification-service a los dueños de los grupos públicos de la carrera del organizador |
| `wf-90-service-token` | subflujo | Token `typ=service` de identity (cliente `n8n`), cacheado en *static data* hasta 30 s antes de `exp` |
| `wf-91-dedupe` | subflujo | Anillo de 2 000 claves en *static data* para envíos directos (SMTP/Telegram) |
| `wf-99-error-handler` | Error Trigger | Email (y Telegram opcional) a `N8N_ERROR_EMAIL`; es el *error workflow* de todos los demás |

Idempotencia: llamadas a servicios con `Idempotency-Key` **UUID determinista** derivado del evento/cron
(los servicios exigen formato UUID) y `dedupeKey` por usuario en notification; envíos directos con `wf-91`.

## Importar y exportar

```bash
make n8n-validate   # JSON válido, sin secretos, referencias coherentes (CI)
make n8n-import     # recrea el contenedor n8n: importa credenciales + workflows y publica los "active": true
make n8n-export     # exporta lo que hay en el n8n vivo a n8n/workflows/ (normalizado) → revisar y commitear
```

`make up` / `make up-infra` ya importan al arrancar: el contenedor usa `n8n/scripts/entrypoint.sh`, que
(1) renderiza `credentials/*.json.tpl` con variables de entorno y hace `n8n import:credentials`,
(2) `n8n import:workflow --separate --input=/import/workflows`, (3) `n8n publish:workflow --id=<id>` por cada JSON con
`"active": true` y (4) `n8n start`. **Verificado en 2.43.5:** `--activeState=fromJson` y `update:workflow --active` solo
funcionan en modo cola; en modo normal se importa y se publica por id antes de arrancar. Los IDs de workflow son fijos
(`wf00router`, `wf01welcome`…) para que `Execute Workflow` y el error workflow los referencien.
Editar en la UI no basta: hay que `make n8n-export` y commitear; `make n8n-import` pisa lo no exportado.

Propietario: si `N8N_OWNER_PASSWORD_HASH` (bcrypt) está definido, n8n crea el propietario por variables
(`N8N_OWNER_EMAIL`, por defecto `admin@bandada.localhost`; contraseña de desarrollo `Bandada-n8n-dev1`).
Genera otro hash con `node -e "console.log(require('bcryptjs').hashSync('<clave>',10))"` dentro del contenedor.

## Credenciales y variables

Nada de secretos en git. Las credenciales de n8n (`rabbitmq`, `smtp`) salen de `credentials/*.json.tpl` (ids fijos
`bandadaRabbit`, `bandadaSmtp`) y variables `RABBITMQ_N8N_PASSWORD`, `SMTP_*`. El secreto del cliente de servicio
(`N8N_SERVICE_CLIENT_SECRET`) **no** es credencial de n8n: lo lee `wf-90` con `$env`; debe coincidir con
`n8n:<secreto>` en `SERVICE_CLIENTS` de identity (ya incluido en `.env.example`). Variables de los workflows
(ver `.env.example` y el servicio `n8n` de `docker-compose.yaml`): `BANDADA_*_INTERNAL_URL`, `N8N_WELCOME_DELAY`,
`N8N_REPORT_POLL_SECONDS`, `N8N_STAFF_RECIPIENTS` (JSON `[{email,locale,roles}]`; vacío = `moderacion@` es MODERATOR y
`admin@` en ADMIN), `N8N_ERROR_EMAIL`, `MAIL_FROM`, `TELEGRAM_BOT_TOKEN`/`TELEGRAM_STAFF_CHAT_ID` (opcionales).
Los textos a destinatarios del equipo viven en los nodos Code (es/en por `locale`); los de estudiantes los renderiza
notification-service (excepto la bienvenida por email, que envía wf-01 según `data.locale` del evento).

## Probar cada workflow (infra levantada: `make up`)

Publicar un evento a mano (API HTTP de gestión de RabbitMQ, sin dependencias; usa `admin/admin` de desarrollo):

```bash
node n8n/scripts/publish-event.mjs <routing.key> '<json de data>' [--id <uuid>]   # repetir --id prueba la idempotencia
```

| Workflow | Prueba | Resultado esperado |
|---|---|---|
| wf-01 | registrar un usuario (`locale: en`) o publicar `bandada.identity.user.registered.v1` con `userId,email,universityId,displayName,roles,locale` | email "Welcome to Bandada U…" en Mailpit (`http://localhost:8025`); con `N8N_WELCOME_DELAY=3600` tarda 1 h |
| wf-02 | crear y publicar un evento que empiece en ~24 h 30 min, inscribir a un usuario y `docker exec -e N8N_RUNNERS_BROKER_PORT=5680 <proyecto>-n8n-1 n8n execute --id=wf02reminder` | notificación `EVENT_REMINDER` (`GET /notifications` del usuario / email); repetir la ejecución no duplica |
| wf-03 | `publish-event.mjs bandada.media.asset.flagged.v1 '{"mediaId":"…","ownerId":"…","maxScore":0.97,"labels":[],"scores":{},"kind":"IMAGE","decision":"REVIEW","modelVersion":"x"}'` | email a `moderacion@bandada.localhost`; con `maxScore<0.95` no pasa nada |
| wf-04 | `n8n execute --id=wf04weekly` (mismo prefijo `docker exec -e N8N_RUNNERS_BROKER_PORT=5680`) | con insights: email "Resumen semanal…" con enlace al panel; sin insights: email "No se pudo generar…" |
| wf-05 | `publish-event.mjs bandada.insights.alert.raised.v1 '{"alertId":"<uuid>","severity":"CRITICAL","kind":"X","message":"…","details":{},"agentRunId":null}'` | un solo email a admins aunque se repita |
| wf-06 | `publish-event.mjs bandada.events.event.published.v1 '{"eventId":"…","organizerId":"<usuario con carrera>","title":"…","startsAt":"…","venue":"…","capacity":10,"priceCredits":0}'` | `NEW_EVENT` para los dueños de grupos públicos de esa carrera |
| error | evento con JSON inválido a `bandada.events.event.published.v1` | email `[n8n] Fallo en wf-00-router` a `N8N_ERROR_EMAIL` |

Ejecuciones: `http://localhost:5678` (usuario propietario arriba) → *Executions*.

## Limitaciones conocidas

- `social-service` devuelve `[]` en `GET /internal/v1/groups` **sin** `career` (el contrato dice "los más grandes"); wf-01/wf-06
  solo sugieren/difunden cuando el perfil tiene carrera.
- wf-06: el contrato no expone miembros de grupo ni listado de usuarios; se notifica a los dueños de los grupos de la carrera.
- wf-02 ventana 23–25 h (cada evento cae en 2 corridas; no duplica por `dedupeKey`). Páginas de 50 con cursor.
- wf-04 no adjunta audio (decisión: enlace al panel, la URL prefirmada vence en 15 min).
- Código `Code` usa el *task runner* interno de n8n (RAM: `mem_limit: 1g`). `n8n execute` en un contenedor ya en marcha
  necesita `N8N_RUNNERS_BROKER_PORT=5680` para no chocar con el broker del proceso principal.
- Un mensaje inválido en el router falla la ejecución (error workflow) y n8n lo descarta; no llega a `n8n.automation.dlq`.
