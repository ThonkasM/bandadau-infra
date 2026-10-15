#!/usr/bin/env node
// Humo de la fase 1: registro → verificación (Mailpit) → login → post → recarga idempotente → inscripción pagada con
// ticket ES256 → EVENT_FULL → inscripción con fallo y compensación (CHAOS_TICKETING_FAIL) → moderador y GraphQL.
// Requiere `make up && make seed`. Sale con código ≠ 0 si algún paso falla.
//   make smoke | node smoke/smoke.mjs [--no-chaos] [--only=chaos]
// Variables: SMOKE_CHAOS=0 (omite el paso de caos), SMOKE_CHAOS_MODE=docker|http (http: POST $SMOKE_CHAOS_URL?fail=true|false)
import { createPublicKey, verify } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cfg, env } from '../seed/lib/env.mjs';
import { request, poll, sleep, waitForUrl, problem } from '../seed/lib/http.mjs';
import { stableUuid, uuidv7 } from '../seed/lib/ids.mjs';
import { createReport } from '../seed/lib/report.mjs';
import { ensureUser, login } from '../seed/lib/identity.mjs';
import { waitForVerificationCode } from '../seed/lib/mailpit.mjs';

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];
const chaosEnabled = !args.includes('--no-chaos') && env('SMOKE_CHAOS', '1') !== '0';
const run = Date.now().toString(36);
const password = cfg.password;
const report = createReport(`Smoke Bandada U (fase 1) — corrida ${run}`);
const { step } = report;
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ticketingUrl = `http://localhost:${cfg.ticketingPort}`;

// ---------------------------------------------------------------------------------------------------------------
// utilidades de negocio
// ---------------------------------------------------------------------------------------------------------------
const api = (method, path, opts) => request(method, `${cfg.api}${path}`, opts);

async function university() {
  const r = await api('GET', '/universities?limit=50');
  expect(r.ok, `GET /universities ${problem(r)}`);
  const u = (r.json.items ?? []).find((x) => x.allowedDomains?.includes('umsa.edu.bo'));
  expect(u, 'no existe la universidad UMSA (ejecuta `make seed`)');
  return u;
}

async function newStudent(tag, uni) {
  const email = `smoke.${tag}.${run}@umsa.edu.bo`;
  const { tokens, user } = await ensureUser({ email, password, universityId: uni.id });
  return { email, token: tokens.accessToken, user };
}

async function balance(token) {
  const w = await api('GET', '/wallet/me', { token });
  expect(w.ok, `GET /wallet/me ${problem(w)}`);
  return w.json.balanceCredits;
}

async function topUp(token, pkg, label) {
  const key = uuidv7();
  const first = await api('POST', '/wallet/topups', { token, idempotencyKey: key, body: { package: pkg } });
  expect(first.status === 201, `createTopUp ${problem(first)}`);
  return { key, topUp: first.json, label };
}

async function createPaidEvent(orgToken, { capacity, priceCredits, title }) {
  const c = await api('POST', '/events', {
    token: orgToken,
    idempotencyKey: uuidv7(),
    body: {
      title: `${title} ${run}`,
      description: 'Evento creado por make smoke; puede borrarse.',
      startsAt: new Date(Date.now() + 5 * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      venue: 'Aula de pruebas',
      capacity,
      priceCredits,
    },
  });
  expect(c.status === 201, `createEvent ${problem(c)}`);
  const p = await api('POST', `/events/${c.json.id}/publish`, { token: orgToken });
  expect(p.ok, `publishEvent ${problem(p)}`);
  return c.json;
}

async function register(token, eventId) {
  return api('POST', `/events/${eventId}/registrations`, { token, idempotencyKey: uuidv7() });
}

async function waitRegistration(token, registrationId, terminal, timeoutMs = 45000) {
  return poll(async () => {
    const r = await api('GET', `/registrations/${registrationId}`, { token });
    return r.ok && terminal.includes(r.json.status) ? r.json : null;
  }, { timeoutMs, intervalMs: 1000 });
}

// chaos: docker compose recrea ticketing con CHAOS_TICKETING_FAIL (por defecto) o un endpoint HTTP de pruebas
async function setTicketingChaos(on) {
  if (env('SMOKE_CHAOS_MODE', 'docker') === 'http') {
    const r = await request('POST', `${env('SMOKE_CHAOS_URL')}?fail=${on}`);
    expect(r.ok, `chaos http: ${problem(r)}`);
    return;
  }
  const projectArgs = cfg.project ? ['-p', cfg.project] : [];
  const p = spawnSync('docker', ['compose', ...projectArgs, '--profile', '*', 'up', '-d', '--no-deps', '--force-recreate', 'ticketing-service'], {
    cwd: REPO_ROOT, env: { ...process.env, CHAOS_TICKETING_FAIL: String(on) }, encoding: 'utf8',
  });
  expect(p.status === 0, `docker compose up ticketing-service falló: ${(p.stderr || p.stdout || '').trim().slice(-300)}`);
  expect(await waitForUrl(`${ticketingUrl}/health/ready`, { timeoutMs: 120000, ok: (s) => s === 200 }), 'ticketing-service no volvió a estar ready');
}

// ---------------------------------------------------------------------------------------------------------------
// flujo
// ---------------------------------------------------------------------------------------------------------------
const ctx = {};

if (only !== 'chaos') {
  await step('Borde: API responde (Traefik → identity)', async () => {
    expect(await waitForUrl(`${cfg.api}/universities`, { timeoutMs: 60000, ok: (s) => s === 200 }), `${cfg.api}/universities no responde 200`);
  });
  await step('Borde: /internal/** → 403 y service-token → 403 en Traefik', async () => {
    const base = cfg.api.replace(/\/api\/v1$/, '');
    const a = await request('GET', `${base}/internal/v1/users`);
    const b = await request('POST', `${cfg.api}/auth/service-token`, { body: { clientId: 'x', clientSecret: 'y' } });
    expect(a.status === 403, `/internal/v1/users devolvió ${a.status}`);
    expect(b.status === 403, `/api/v1/auth/service-token devolvió ${b.status}`);
  });

  ctx.uni = await step('Universidades UMSA disponible', async () => { ctx.uni = await university(); return ctx.uni.name; }).then(() => ctx.uni);

  // --- UC-01: registro con idempotencia, verificación y login -------------------------------------------------
  const email = `smoke.main.${run}@umsa.edu.bo`;
  const regKey = uuidv7();
  const regAt = Date.now();
  let regUser;
  await step('Registro (201 PENDING_VERIFICATION)', async () => {
    const r = await api('POST', '/auth/register', { idempotencyKey: regKey, body: { email, password, universityId: ctx.uni.id, locale: 'es' } });
    expect(r.status === 201, `register ${problem(r)}`);
    expect(r.json.status === 'PENDING_VERIFICATION', `status ${r.json.status}`);
    regUser = r.json;
    return r.json.userId;
  });
  await step('Registro repetido con la misma Idempotency-Key → misma respuesta', async () => {
    const r = await api('POST', '/auth/register', { idempotencyKey: regKey, body: { email, password, universityId: ctx.uni.id, locale: 'es' } });
    expect(r.ok, `replay ${problem(r)}`);
    expect(r.json.userId === regUser?.userId, 'otro userId en el replay');
    expect(r.headers.get('idempotent-replayed') === 'true', 'falta la cabecera Idempotent-Replayed: true');
  });
  let tokens;
  await step('Verificación de email (código desde Mailpit)', async () => {
    const code = await waitForVerificationCode(email, { sinceMs: regAt });
    expect(code, `no llegó el correo de ${email} a Mailpit`);
    const r = await api('POST', '/auth/verify-email', { body: { email, code } });
    expect(r.ok, `verify-email ${problem(r)}`);
    expect(r.json.user?.status === 'ACTIVE', `status ${r.json.user?.status}`);
    return `código ${code}`;
  });
  await step('Login y GET /users/me', async () => {
    const r = await login(email, password);
    expect(r.ok, `login ${problem(r)}`);
    tokens = r.json;
    const me = await api('GET', '/users/me', { token: tokens.accessToken });
    expect(me.ok && me.json.email === email, `users/me ${problem(me)}`);
    return `roles ${me.json.roles.join('+')}`;
  });
  ctx.token = tokens?.accessToken;

  // --- UC-05/06: post -----------------------------------------------------------------------------------------------
  await step('Post publicado y legible (UC-05)', async () => {
    const clientId = uuidv7();
    const c = await api('POST', '/posts', { token: ctx.token, idempotencyKey: uuidv7(), body: { clientId, text: `Smoke ${run} #bandada`, mediaIds: [], visibility: 'PUBLIC' } });
    expect(c.status === 201 || c.status === 200, `createPost ${problem(c)}`);
    const g = await api('GET', `/posts/${c.json.id}`, { token: ctx.token });
    expect(g.ok, `getPost ${problem(g)}`);
    const dup = await api('POST', '/posts', { token: ctx.token, idempotencyKey: uuidv7(), body: { clientId, text: `Smoke ${run} #bandada`, mediaIds: [], visibility: 'PUBLIC' } });
    expect(dup.ok && dup.json.id === c.json.id, `clientId repetido debe devolver el mismo post (${problem(dup)})`);
    return c.json.id;
  });
  await step('Feed responde (UC-06)', async () => {
    const r = await api('GET', '/feed?limit=10', { token: ctx.token });
    expect(r.ok && Array.isArray(r.json.items), `feed ${problem(r)}`);
    return `${r.json.items.length} ítems`;
  });

  // --- UC-15: recarga idempotente (doble envío = un cargo) ------------------------------------------------------------------
  let topup;
  await step('Recarga: createTopUp repetido con la misma clave → misma recarga', async () => {
    topup = await topUp(ctx.token, 'CREDITS_50');
    const again = await api('POST', '/wallet/topups', { token: ctx.token, idempotencyKey: topup.key, body: { package: 'CREDITS_50' } });
    expect(again.ok && again.json.topUpId === topup.topUp.topUpId, `otra recarga en el replay (${problem(again)})`);
    expect(again.headers.get('idempotent-replayed') === 'true', 'falta Idempotent-Replayed: true');
    return topup.topUp.topUpId;
  });
  await step('Recarga: doble "pagar" simultáneo → saldo +50 una sola vez', async () => {
    const pay = () => api('POST', `/wallet/topups/${topup.topUp.topUpId}/simulate-payment`, { token: ctx.token, body: { outcome: 'PAID' } });
    const results = await Promise.all([pay(), pay()]);
    for (const r of results) expect([200, 409].includes(r.status), `simulate-payment ${problem(r)}`);
    const bal = await poll(async () => { const b = await balance(ctx.token); return b >= 50 ? b : null; }, { timeoutMs: 15000 });
    expect(bal === 50, `saldo esperado 50, actual ${bal}`);
    const entries = await api('GET', '/wallet/me/entries?limit=50', { token: ctx.token });
    const credits = (entries.json.items ?? []).filter((e) => String(e.operationRef).startsWith('TOPUP:'));
    expect(credits.length === 1, `se esperaba 1 movimiento TOPUP, hay ${credits.length}`);
    return 'saldo 50, 1 asiento TOPUP';
  });

  // --- UC-11/12/13/14: evento, inscripción pagada, ticket ES256, EVENT_FULL -----------------------------------------------
  const org = await step('Login del organizador (org@umsa.edu.bo)', async () => {
    const r = await login('org@umsa.edu.bo', password);
    expect(r.ok, `login org ${problem(r)} — ¿ejecutaste make seed?`);
    expect(r.json.user.roles.includes('ORGANIZER'), 'org no tiene rol ORGANIZER');
    return r.json.accessToken;
  });
  let paidEvent;
  await step('Organizador crea y publica un evento de 20 créditos', async () => {
    expect(org, 'sin sesión del organizador');
    paidEvent = await createPaidEvent(org, { capacity: 5, priceCredits: 20, title: 'Smoke pagado' });
    return paidEvent.id;
  });
  await step('Inscripción pagada: 202 PENDING → CONFIRMED con ticket', async () => {
    expect(paidEvent, 'sin evento');
    const r = await register(ctx.token, paidEvent.id);
    expect(r.status === 202, `registerToEvent ${problem(r)}`);
    expect(r.json.status === 'PENDING', `status inicial ${r.json.status}`);
    const done = await waitRegistration(ctx.token, r.json.id, ['CONFIRMED', 'FAILED', 'CANCELLED']);
    expect(done, 'la SAGA no terminó en 45 s');
    expect(done.status === 'CONFIRMED', `terminó ${done.status} (${done.failureReason ?? 'sin motivo'})`);
    expect(done.ticketId, 'CONFIRMED sin ticketId');
    ctx.ticketId = done.ticketId;
    return `ticket ${done.ticketId}`;
  });
  await step('Débito de 20 créditos aplicado (saldo 30)', async () => {
    const bal = await balance(ctx.token);
    expect(bal === 30, `saldo esperado 30, actual ${bal}`);
  });
  await step('Ticket con QR firmado ES256 verificable con /tickets/signing-keys', async () => {
    const t = await api('GET', `/tickets/${ctx.ticketId}`, { token: ctx.token });
    expect(t.ok, `getTicket ${problem(t)}`);
    expect(t.json.status === 'ISSUED', `status ${t.json.status}`);
    const [h, p, s] = String(t.json.qrPayload).split('.');
    expect(h && p && s, 'qrPayload no es un JWS compacto');
    const header = b64json(h);
    expect(header.alg === 'ES256', `alg ${header.alg}`);
    const keys = await api('GET', '/tickets/signing-keys', { token: ctx.token });
    expect(keys.ok, `signing-keys ${problem(keys)}`);
    const jwk = (keys.json.keys ?? []).find((k) => k.kid === header.kid);
    expect(jwk, `no hay clave pública para kid ${header.kid}`);
    const ok = verify('sha256', Buffer.from(`${h}.${p}`), { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
    expect(ok, 'la firma ES256 del QR no verifica');
    return `kid ${header.kid}`;
  });
  await step('Inscripción repetida al mismo evento → 409 ALREADY_REGISTERED', async () => {
    const r = await register(ctx.token, paidEvent.id);
    expect(r.status === 409, `esperaba 409, HTTP ${r.status}`);
    expect(r.json?.code === 'ALREADY_REGISTERED', `code ${r.json?.code}`);
  });
  await step('Notificación in-app de la inscripción (notification-service)', async () => {
    const n = await poll(async () => {
      const r = await api('GET', '/notifications?limit=20', { token: ctx.token });
      return r.ok && (r.json.items ?? []).length > 0 ? r.json.items : null;
    }, { timeoutMs: 30000 });
    expect(n, 'sin notificaciones tras 30 s');
    return `${n.length} notificación(es)`;
  });
  await step('Cupo 1: segundo usuario recibe 409 EVENT_FULL', async () => {
    expect(org, 'sin sesión del organizador');
    const ev = await createPaidEvent(org, { capacity: 1, priceCredits: 0, title: 'Smoke cupo 1' });
    const other = await newStudent('full', ctx.uni);
    const a = await register(ctx.token, ev.id);
    expect(a.status === 202, `primer usuario ${problem(a)}`);
    const done = await waitRegistration(ctx.token, a.json.id, ['CONFIRMED', 'FAILED']);
    expect(done?.status === 'CONFIRMED', `primer usuario terminó ${done?.status}`);
    const b = await register(other.token, ev.id);
    expect(b.status === 409 && b.json?.code === 'EVENT_FULL', `esperaba 409 EVENT_FULL, ${problem(b)}`);
  });

  // --- UC-18/21: moderador y GraphQL -------------------------------------------------------------------------------------------
  const gql = (token, query) => request('POST', cfg.graphql, { token, body: { query } });
  let modToken;
  await step('Login del moderador (mod@umsa.edu.bo)', async () => {
    const r = await login('mod@umsa.edu.bo', password, 'admin');
    expect(r.ok, `login mod ${problem(r)} — ¿ejecutaste make seed?`);
    expect(r.json.user.roles.includes('MODERATOR'), 'mod no tiene rol MODERATOR');
    modToken = r.json.accessToken;
  });
  await step('GraphQL moderationQueue (moderador)', async () => {
    expect(modToken, 'sin sesión del moderador');
    const r = await gql(modToken, '{ moderationQueue(first: 5) { totalCount edges { node { id source openReports } } } }');
    expect(r.ok, `graphql ${problem(r)}`);
    expect(!r.json?.errors, `errores GraphQL: ${String(JSON.stringify(r.json?.errors)).slice(0, 200)}`);
    expect(Number.isInteger(r.json.data.moderationQueue.totalCount), 'totalCount inválido');
    return `totalCount ${r.json.data.moderationQueue.totalCount}`;
  });
  await step('GraphQL: un estudiante recibe FORBIDDEN (RBAC)', async () => {
    const r = await gql(ctx.token, '{ moderationQueue(first: 1) { totalCount } }');
    const code = r.json?.errors?.[0]?.extensions?.code;
    expect(code === 'FORBIDDEN' || code === 'UNAUTHENTICATED', `esperaba FORBIDDEN, obtuvo ${code ?? `HTTP ${r.status}`}`);
    return code;
  });
}

// --- compensación de la SAGA (D2): ticketing falla → reembolso ------------------------------------------------------------------
if (!chaosEnabled && only !== 'chaos') {
  await step('SAGA con fallo en ticketing → compensación (reembolso)', async () => {}, { skip: 'omitido (SMOKE_CHAOS=0 / --no-chaos)' });
} else {
  let org2; let chaosStudent; let chaosEvent; let before;
  await step('Preparar: usuario con 50 créditos y evento de 20 créditos', async () => {
    const uni = ctx.uni ?? await university();
    const o = await login('org@umsa.edu.bo', password);
    expect(o.ok, `login org ${problem(o)}`);
    org2 = o.json.accessToken;
    chaosEvent = await createPaidEvent(org2, { capacity: 5, priceCredits: 20, title: 'Smoke caos' });
    chaosStudent = await newStudent('chaos', uni);
    const t = await topUp(chaosStudent.token, 'CREDITS_50');
    const pay = await api('POST', `/wallet/topups/${t.topUp.topUpId}/simulate-payment`, { token: chaosStudent.token, body: { outcome: 'PAID' } });
    expect(pay.ok || pay.status === 409, `simulate-payment ${problem(pay)}`);
    before = await poll(async () => { const b = await balance(chaosStudent.token); return b >= 50 ? b : null; }, { timeoutMs: 15000 });
    expect(before === 50, `saldo inicial ${before}`);
  });
  let chaosOn = false;
  try {
    await step('Activar CHAOS_TICKETING_FAIL en ticketing-service', async () => { await setTicketingChaos(true); chaosOn = true; return env('SMOKE_CHAOS_MODE', 'docker'); });
    await step('Inscripción con fallo en ticketing → FAILED y créditos reembolsados', async () => {
      expect(chaosOn && chaosStudent && chaosEvent, 'pasos previos fallaron');
      const r = await register(chaosStudent.token, chaosEvent.id);
      expect(r.status === 202, `registerToEvent ${problem(r)}`);
      const done = await waitRegistration(chaosStudent.token, r.json.id, ['FAILED', 'CONFIRMED', 'CANCELLED'], 90000);
      expect(done, 'la SAGA no terminó en 90 s');
      expect(done.status === 'FAILED', `esperaba FAILED, terminó ${done.status}`);
      expect(done.failureReason === 'TICKET_ISSUE_FAILED', `failureReason ${done.failureReason}`);
      const bal = await poll(async () => { const b = await balance(chaosStudent.token); return b === 50 ? b : null; }, { timeoutMs: 30000 });
      expect(bal === 50, `saldo tras compensar debería ser 50, es ${await balance(chaosStudent.token)}`);
      const entries = await api('GET', '/wallet/me/entries?limit=50', { token: chaosStudent.token });
      const types = (entries.json.items ?? []).map((e) => e.type);
      expect(types.includes('DEBIT') && types.includes('REFUND'), `libro mayor sin DEBIT+REFUND (${types.join(',')})`);
      return 'FAILED · DEBIT + REFUND · saldo 50';
    });
  } finally {
    await step('Restaurar ticketing-service (caos desactivado)', async () => { await setTicketingChaos(false); }, chaosOn ? undefined : { skip: 'el caos nunca se activó' });
  }
}

process.exit(report.finish());
