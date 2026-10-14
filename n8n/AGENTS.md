# AGENTS.md — bandadau-infra/n8n/

Lee primero el `AGENTS.md` del workspace, `../AGENTS.md` (repo `bandadau-infra`), `bandadau-docs/docs/03-arquitectura/decisiones-clave.md` (D10),
`bandadau-docs/docs/03-arquitectura/automatizacion-n8n.md`, `bandadau-docs/docs/03-arquitectura/catalogo-servicios.md` §5
(cola `n8n.automation`) y `bandadau-docs/docs/04-patrones-y-reglas/definition-of-done.md` §7.

## Identidad

Workflows de **automatización** (T10) versionados como JSON: bienvenida, recordatorios de eventos,
escalamiento de moderación, resumen semanal generativo y alertas críticas. n8n corre como
contenedor de la plataforma (`:5678`); este directorio es la **fuente de verdad** de los workflows.

## Stack

n8n (imagen oficial; fijar versión en `bandadau-infra/compose/`) · nodo RabbitMQ Trigger · HTTP Request · Cron/Schedule ·
Email (SMTP → Mailpit/SES) · Telegram (opcional) · Node 24 para scripts de validación.

## Carpetas

```
bandadau-infra/n8n/
├── workflows/
│   ├── wf-00-router.json               único consumidor de n8n.automation (D15)
│   ├── wf-01-bienvenida.json
│   ├── wf-02-recordatorio-evento.json
│   ├── wf-03-escalamiento-moderacion.json
│   ├── wf-04-resumen-semanal.json
│   ├── wf-05-alerta-critica.json
│   ├── wf-06-difusion-evento.json
│   └── wf-90-service-token.json · wf-91-dedupe.json · wf-99-error-handler.json   (subflujos de apoyo)
├── templates/{es,en}/              cuerpos de email/mensaje por idioma
├── credentials/*.json.tpl          plantillas sin secretos (las renderiza bootstrap.sh)
├── scripts/
│   ├── bootstrap.sh                credenciales desde variables de entorno (n8n import:credentials)
│   ├── import.sh · export.sh       n8n import/export:workflow --separate (verificar CLI)
│   ├── normalize.mjs               ordena claves, quita campos volátiles, fija active: false
│   ├── publish-test-event.sh       publica un CloudEvent de ejemplo del contrato
│   └── validate.mjs                JSON válido, sin credenciales embebidas, disparadores esperados
└── .env.example
```

## Workflows (D10 + D15)

`wf-00-router` es el **único** consumidor de la cola `n8n.automation` y despacha a los subflujos
(D15); los disparadores RabbitMQ de abajo se reciben a través de él.

| Workflow | Disparador | Acciones |
|---|---|---|
| `wf-00-router` | cola `n8n.automation` | despacha por `type` del CloudEvent a `wf-01`, `wf-03`, `wf-05`, `wf-06` |
| `wf-01-bienvenida` | `bandada.identity.user.registered.v1` | espera 1 h → email de bienvenida (idioma del usuario) + sugerir grupos (REST social) |
| `wf-02-recordatorio-evento` | Cron cada hora | eventos que empiezan en 24 h → por inscrito confirmado: notificación (REST interno de notification) |
| `wf-03-escalamiento-moderacion` | `bandada.media.asset.flagged.v1` | `score ≥ 0.95` o 3+ flags del autor en 24 h → aviso a moderadores + alerta (REST insights) |
| `wf-04-resumen-semanal` | Cron lunes 08:00 `America/La_Paz` | `requestReport` "Resumen de la semana" → espera `READY` → email a admins con texto + audio |
| `wf-05-alerta-critica` | `bandada.insights.alert.raised.v1` (`severity=CRITICAL`) | Telegram/email al equipo |
| `wf-06-difusion-evento` | `bandada.events.event.published.v1` | notificación a estudiantes de la carrera/grupo (D15) |

## Comandos (propuestos)

```bash
# desde bandadau-infra/
make infra-up                                  # levanta n8n en :5678
./n8n/scripts/import.sh                        # carga workflows al n8n local
./n8n/scripts/export.sh                        # tras editar en la UI, exporta y commitea
node n8n/scripts/validate.mjs                  # corre en CI
```

## Variables de entorno (`.env.example`)

```
N8N_PORT=5678
GENERIC_TIMEZONE=America/La_Paz
N8N_ENCRYPTION_KEY=change-me
RABBITMQ_URL=amqp://bandada:bandada@rabbitmq:5672
BANDADA_API_INTERNAL_URL=http://traefik            # o URLs por servicio en la red interna
SOCIAL_SERVICE_URL=http://social-service:7002
EVENTS_SERVICE_URL=http://events-service:7004
NOTIFICATION_SERVICE_URL=http://notification-service:7007
INSIGHTS_SERVICE_URL=http://insights-service:7008
IDENTITY_URL=http://identity-service:7001
N8N_SERVICE_CLIENT_ID=n8n
N8N_SERVICE_CLIENT_SECRET=change-me
SMTP_HOST=mailpit
SMTP_PORT=1025
MAIL_FROM=no-reply@bandadau.com
ADMIN_EMAILS=admin@bandadau.local
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

## Contratos

- Consume la cola `n8n.automation` con los bindings del catálogo §5 (CloudEvents de `bandadau-docs/contracts/asyncapi`).
- Llama solo a endpoints declarados en `bandadau-docs/contracts/openapi` (públicos con token de servicio o `/internal/v1`);
  si falta uno (p. ej. envío dirigido de notificaciones), **agregarlo al contrato primero**.

## Reglas específicas y gotchas

- Credenciales **solo** por variables de entorno / credenciales de n8n; el JSON exportado no debe contener
  secretos ni IDs de credenciales reales (`validate.mjs` lo verifica).
- Idempotencia: deduplicar por `id` del CloudEvent (o clave natural `eventId+userId+fecha`) antes de enviar.
- Mensajes a personas en su idioma (`templates/{es,en}`, `locale` del destinatario; `es` por defecto). Nunca
  textos traducidos en los eventos.
- Rama de error (*Error Workflow*) que registra el fallo y avisa; nada de fallos silenciosos.
- Zona horaria `America/La_Paz` para crons.
- Editar en la UI está permitido, pero el cambio no existe hasta que se **exporta y commitea**.

## Casos de uso

UC-01 (bienvenida), UC-23 (recordatorios y resumen semanal), UC-18 (escalamiento), UC-20 (alertas críticas).

## Definición de hecho

`definition-of-done.md` §7 + ejecución de prueba con el evento de ejemplo del contrato.
