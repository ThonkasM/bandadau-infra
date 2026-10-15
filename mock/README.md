# Gateway mock de Bandada U

Servidor Node 24 (Fastify 5 + graphql 17 + graphql-ws 6, sin Docker) que imita el gateway
`api.bandada.localhost` para desarrollar frontends mientras el backend real no está listo.
**Rutas, validación de cuerpos, seguridad e `Idempotency-Key` salen de `bandadau-docs/contracts/`** (OpenAPI y
`admin.graphql`, solo lectura); los datos viven en memoria y se reinician al detener el proceso.

```bash
cd bandadau-infra
make mock         # http://localhost:4010 (en segundo plano; logs en mock/.mock.log)  [MOCK_PORT=4011 make mock]
make mock-stop
make mock-test    # 33 pruebas: respuestas validadas contra el OpenAPI (ajv), SDL, GraphQL, WebSocket
```
Primera vez: `make mock` instala dependencias (`npm ci`). Si el puerto está ocupado, falla con un mensaje claro.
Reiniciar datos sin parar el proceso: `POST /__mock/reset`. Índice: `GET /`.

## Usuarios y códigos
| Correo | Rol | Notas |
|---|---|---|
| `admin@umsa.edu.bo` | ADMIN | panel |
| `mod@umsa.edu.bo` | MODERATOR | cola de moderación |
| `org@umsa.edu.bo` | ORGANIZER | organizador de los eventos; valida tickets |
| `lucia@umsa.edu.bo` | STUDENT | wallet 100 créditos, ticket del Hackatón, notificaciones sin leer |
| `marco@umsa.edu.bo` | STUDENT | wallet 30, inscripción atascada (SAGA FAILED) |
| camila@umsa, andres@umsa, diego@ucb, valeria@ucb, sofia@ucb | STUDENT | relleno del feed |

Contraseña `Bandada#2026`. Código de verificación de email **`123456`** (5 intentos fallidos → `VERIFICATION_ATTEMPTS_EXCEEDED`; `resend-code` los reinicia).
Universidades: UMSA `0192a3b0-0001-7000-8000-000000000001` (`umsa.edu.bo`), UCB `...0002` (`ucb.edu.bo`).

## Comportamiento simulado
- **Auth**: JWT de juguete **HS256** (15 min); refresh opaco con rotación y detección de reutilización (`REFRESH_TOKEN_REUSED`).
  Cabecera `X-Bandada-Client: web|admin` → cookie `refresh_token` (HttpOnly, SameSite=Strict, Path=/api/v1/auth) y `refreshToken: ""` en el cuerpo;
  `native` (o sin cabecera) → refresh en el cuerpo. `refresh`/`logout` aceptan la cookie sin cuerpo.
  Handoff PKCE (UC-03): `POST /auth/handoff` → `redirectUrl` a `localhost:3001` (ADMIN, solo MODERATOR/ADMIN) o `localhost:8081` (APP); `exchange` verifica S256, 60 s, un solo uso.
- **Registro**: dominio del correo debe pertenecer a la universidad; queda `PENDING_VERIFICATION` hasta `verify-email` (que devuelve tokens).
- **Feed/posts**: 30+ posts semilla (es), algunos con imagen servida en `/mock-assets/*` (PNG/SVG generados). Cursor opaco (`nextCursor`), `limit` 1–50.
  Comentarios, reacciones, follows, sugerencias, grupos (público → ACTIVE, privado → PENDING + aprobar/rechazar), denuncias (≥3 abiertas ocultan el post).
- **Media**: `createUpload` devuelve un PUT a `/mock-assets/uploads/{id}`; sin PUT → `UPLOAD_MISSING`. `complete` → `PROCESSING`, a 0.8 s `APPROVED`
  (publica los posts en `PENDING_MEDIA`). Pasa a `FLAGGED` (entra a la cola) si el `fileName` contiene `flag` o con `MOCK_MODERATION_MODE=manual`.
- **Inscripción (SAGA)**: `registerToEvent` → 202 `PENDING` (+`Location`, `Retry-After: 1`); cada 0.5 s: débito → ticket → `CONFIRMED` (≈1.5 s).
  Evento de cupo 1 ya tomado → 409 `EVENT_FULL`; saldo insuficiente → `FAILED/INSUFFICIENT_FUNDS`; título con **CHAOS** → débito, falla la emisión
  y se reembolsa (`FAILED/TICKET_ISSUE_FAILED`, SAGA `COMPENSATED`). `cancelRegistration` (≥1 h antes) → `CANCELLATION_PENDING` → `CANCELLED` + reembolso + ticket `VOIDED`.
  Eventos: Hackatón (gratis), Taller de Git (20 créditos), Mesa redonda (cupo 1), «CHAOS Night» (10 créditos, siempre falla), más un borrador del organizador.
- **Wallet**: `createTopUp` (20/50/100 créditos) → `simulate-payment` acredita (repetible, idempotente por estado y por `Idempotency-Key`); webhook acepta `X-Signature: mock-signature`.
- **Tickets**: `qrPayload` es un JWS **ES256 real** (clave efímera, `GET /tickets/signing-keys`); `validateTicket` exige ORGANIZER del evento/ADMIN: `TICKET_ALREADY_USED`, `INVALID_QR_SIGNATURE`, etc.
- **Notificaciones**: se generan por comentarios, reacciones, follows, inscripciones, recargas…; `X-Unread-Count` en el listado.
- **Errores**: `application/problem+json` con `code` estable, `traceId`, `errors[]` en validación; `Accept-Language` es/en (title/detail) y `Content-Language`.
  Idempotencia: `Idempotency-Key` obligatoria en las operaciones ♻️ del contrato (400 si falta); réplica con `Idempotent-Replayed: true`, otro cuerpo → 422 `IDEMPOTENCY_KEY_REUSED`.
- **Fuera de alcance**: `/internal/**` y `/auth/service-token` → 403 (como Traefik); `/api/v1/insights/**`, `/mcp`, MCP tokens → 503 `FEATURE_DISABLED`.
- **Perillas de desarrollo**: cabeceras `X-Mock-Delay: <ms>` y `X-Mock-Fail: <status>[:CODIGO]` fuerzan latencia o error en cualquier ruta REST.

## GraphQL `/graphql` (HTTP + WebSocket `graphql-transport-ws`)
SDL idéntico a `contracts/graphql/admin.graphql`; `@auth` se aplica por rol del token (`Authorization: Bearer`, o `connectionParams.Authorization` / `?token=` en WS):
sin token → `UNAUTHENTICATED`, rol insuficiente → `FORBIDDEN`. Campos de fase 2 (`reports`, `report`, `alerts`, `agentRuns`, `requestReport`, `acknowledgeAlert`,
`runMonitoringNow`, `createMcpToken`, `revokeMcpToken`, `alertRaised`, `reportReady`) → `extensions.code = FEATURE_DISABLED`.
Datos coherentes con REST: `dashboard`, `walletStats` (series simuladas + movimientos reales), `users` (Relay), `moderationQueue` (3 imágenes marcadas + posts denunciados),
`contentReports`, `events/registrations/sagas` (una SAGA `FAILED`; `retrySaga` la completa), `serviceHealth` (notification-service `DEGRADED`).
Las mutaciones (`moderateMedia`, `resolveContentReport` —resuelve todas las denuncias abiertas del mismo contenido—, `suspendUser`, `reactivateUser`, `updateUserRoles`, `createUniversity`) mutan el estado y los usuarios suspendidos no pueden iniciar sesión por REST.
`subscription moderationQueueChanged` emite `ADDED/RESOLVED` tras cada mutación y, mientras haya suscriptores, un cambio simulado cada 20 s
(`MOCK_QUEUE_TICK_MS`): añade una imagen marcada, o aprueba la más antigua si ya hay 8.

## Otros
CORS con credenciales para `http://localhost:{3000,3001,4201,8081}` y `http://{app,admin,mfe}.bandada.localhost` (extra: `MOCK_CORS_ORIGINS`).
`GET /health/ready`, `GET /.well-known/jwks.json` (falso). Variables: `MOCK_PORT`, `MOCK_SAGA_STEP_MS`, `MOCK_QUEUE_TICK_MS`, `MOCK_MODERATION_MODE`, `MOCK_PUBLIC_URL`, `CONTRACTS_DIR`.

## Limitaciones
- Estado solo en memoria; JWT HS256 (no valida contra el JWKS falso); sin rate limiting real (usa `X-Mock-Fail: 429`).
- La cookie `refresh_token` es `SameSite=Strict`: solo viaja entre orígenes *same-site* (`localhost:*` → `localhost:4010`); desde `*.bandada.localhost` el navegador no la enviará.
- Sin e-mail real (el código es fijo), sin push, sin n8n/MCP/insights (fase 2), `uploadUrl` apunta al propio mock (no S3).
