import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { CORS_ORIGINS } from './config.mjs';
import { db, resetDb } from './state.mjs';
import { ajvErrorsToFields, ApiError, fail, fieldError, pickLang, toProblem } from './errors.mjs';
import { compile, loadOperations } from './spec.mjs';
import { paginate, verifyJwt } from './util.mjs';
export { res } from './util.mjs';
import { isStaff } from './domain.mjs';
import { identityHandlers } from './handlers/identity.mjs';
import { socialHandlers } from './handlers/social.mjs';
import { mediaHandlers } from './handlers/media.mjs';
import { eventsHandlers } from './handlers/events.mjs';
import { walletHandlers } from './handlers/wallet.mjs';
import { ticketingHandlers } from './handlers/ticketing.mjs';
import { notificationHandlers } from './handlers/notification.mjs';
import { registerAssets } from './assets.mjs';
import { registerGraphql } from './graphql.mjs';

export const handlers = {
  ...identityHandlers, ...socialHandlers, ...mediaHandlers, ...eventsHandlers, ...walletHandlers, ...ticketingHandlers, ...notificationHandlers,
};

const bodyValidators = new Map();
const BODY_OPTIONAL = new Set(['refreshToken', 'logout']);
// Roles exigidos antes de validar el cuerpo (como el filtro de seguridad del servicio real).
const ROLE_GUARDS = { createEvent: ['ORGANIZER', 'ADMIN'], validateTicket: ['ORGANIZER', 'ADMIN'] };

export async function buildApp({ logger = false } = {}) {
  resetDb();
  const app = Fastify({ logger, bodyLimit: 64 * 1024 * 1024, routerOptions: { ignoreTrailingSlash: true }, trustProxy: true });

  await app.register(cors, {
    origin: [...CORS_ORIGINS, ...(process.env.MOCK_CORS_ORIGINS?.split(',').filter(Boolean) ?? [])],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['Location', 'Retry-After', 'Idempotent-Replayed', 'X-Unread-Count', 'Content-Language', 'X-Correlation-Id', 'WWW-Authenticate'],
    maxAge: 600,
  });

  // JSON tolerante a cuerpo vacío; cualquier otro content-type llega como Buffer (PUT de subidas).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (!body || !body.trim()) return done(null, undefined);
    try { done(null, JSON.parse(body)); } catch { done(Object.assign(new Error('Invalid JSON'), { statusCode: 400, code: 'MOCK_INVALID_JSON' })); }
  });
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (req, body, done) => done(null, body));

  app.decorateRequest('lang', 'es');
  app.addHook('onRequest', async (req) => { req.lang = pickLang(req.headers['accept-language']); });
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/v1') || req.url.startsWith('/graphql') || req.url.startsWith('/.well-known')) {
      reply.header('Content-Language', req.lang);
      reply.header('X-Correlation-Id', req.headers['x-correlation-id'] ?? randomUUID());
    }
    return payload;
  });

  const sendProblem = (req, reply, err) => {
    const { status, body } = toProblem(err, { lang: req.lang, instance: req.url.split('?')[0], traceId: randomUUID().replaceAll('-', '') });
    for (const [k, v] of Object.entries(err.headers ?? {})) reply.header(k, v);
    if (status === 401) reply.header('WWW-Authenticate', 'Bearer');
    return reply.code(status).type('application/problem+json').send(JSON.stringify(body));
  };

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) return sendProblem(req, reply, err);
    if (err.code === 'MOCK_INVALID_JSON' || err.code?.startsWith?.('FST_ERR_CTP')) {
      return sendProblem(req, reply, fail('VALIDATION_FAILED', { detail: err.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ? 'Cuerpo demasiado grande.' : 'JSON mal formado.', errors: [fieldError('(body)', 'INVALID_FORMAT', req.lang, '/')] }));
    }
    if (err.statusCode && err.statusCode < 500) return sendProblem(req, reply, fail(err.statusCode === 404 ? 'NOT_FOUND' : 'VALIDATION_FAILED', { status: err.statusCode, detail: err.message }));
    console.error('[mock] error no controlado', err);
    return sendProblem(req, reply, fail('INTERNAL_ERROR'));
  });
  app.setNotFoundHandler((req, reply) => {
    if (/^\/(api\/v1\/)?internal(\/|$)/.test(req.url)) return sendProblem(req, reply, fail('FORBIDDEN', { detail: 'Las rutas /internal están bloqueadas en el gateway.' }));
    return sendProblem(req, reply, fail('NOT_FOUND', { detail: req.method === 'OPTIONS' ? undefined : 'Ruta inexistente en el mock.' }));
  });

  // ------------------------------------------------------------------ contrato → rutas
  const ops = loadOperations();
  const missing = [];
  for (const op of ops) {
    if (op.id === 'issueServiceToken') {
      app.post(op.url, async (req, reply) => sendProblem(req, reply, fail('FORBIDDEN', { detail: 'service-token está bloqueado en el gateway (Traefik deny-all).' })));
      continue;
    }
    const handler = handlers[op.id];
    if (!handler) { missing.push(op.id); continue; }
    app.route({ method: op.method, url: op.url, handler: wrap(op, handler, (req, reply, e) => sendProblem(req, reply, e)) });
  }
  app.decorate('mockOps', ops);
  app.decorate('missingHandlers', missing);
  // JWKS también en la raíz (Traefik enruta /.well-known fuera de /api/v1)
  app.get('/.well-known/jwks.json', wrap(ops.find((o) => o.id === 'getJwks'), handlers.getJwks, (req, reply, e) => sendProblem(req, reply, e)));

  // Fase 2 / bloqueos
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    app.route({ method: m, url: '/api/v1/insights/*', handler: async (req, reply) => sendProblem(req, reply, fail('FEATURE_DISABLED', { detail: 'insights-service es de la fase 2 y no está disponible en el mock.' })) });
    app.route({ method: m, url: '/mcp', handler: async (req, reply) => sendProblem(req, reply, fail('FEATURE_DISABLED')) });
    app.route({ method: m, url: '/mcp/*', handler: async (req, reply) => sendProblem(req, reply, fail('FEATURE_DISABLED')) });
  }

  // ------------------------------------------------------------------ utilidades del mock
  app.get('/health/live', async () => ({ status: 'UP' }));
  app.get('/health/ready', async () => ({ status: 'UP', service: 'bandada-mock-gateway', checks: { memory: 'UP' } }));
  app.get('/', async () => info());
  app.get('/__mock', async () => info());
  app.post('/__mock/reset', async () => { resetDb(); return { reset: true }; });
  registerAssets(app);
  await registerGraphql(app);

  return app;
}

function info() {
  return {
    name: 'bandada-mock-gateway', rest: '/api/v1', graphql: '/graphql', jwks: '/.well-known/jwks.json',
    users: [...db.users.values()].map((u) => ({ email: u.email, roles: u.roles })), password: 'Bandada#2026', verificationCode: '123456',
    reset: 'POST /__mock/reset',
  };
}

function wrap(op, handler, sendProblem) {
  return async (req, reply) => {
    const lang = req.lang;
    // --- perillas de desarrollo ---
    const delay = Number(req.headers['x-mock-delay']);
    if (delay > 0) await new Promise((r) => setTimeout(r, Math.min(delay, 10_000)));
    const forced = req.headers['x-mock-fail'];
    if (forced) {
      const [st, code] = String(forced).split(':');
      const status = Number(st) || 500;
      const defaults = { 400: 'VALIDATION_FAILED', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 422: 'UNPROCESSABLE_ENTITY', 429: 'RATE_LIMITED', 503: 'SERVICE_UNAVAILABLE' };
      return sendProblem(req, reply, fail(code ?? defaults[status] ?? 'INTERNAL_ERROR', { status, headers: status === 429 || status === 503 ? { 'Retry-After': '5' } : undefined }));
    }

    try {
      // --- autenticación ---
      let user = null;
      const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1];
      if (bearer) {
        const claims = verifyJwt(bearer);
        const u = claims && db.users.get(claims.sub);
        if (u && claims.aud === 'bandada') user = u;
      }
      if (op.security === 'bearer' && !user) throw fail('UNAUTHORIZED');
      if (user?.status === 'SUSPENDED' && op.id !== 'logout') throw fail('ACCOUNT_SUSPENDED');

      const needed = ROLE_GUARDS[op.id];
      if (needed && !needed.some((r) => user.roles.includes(r))) throw fail('FORBIDDEN', { detail: lang === 'en' ? `You need the role ${needed.join(' or ')}.` : `Necesitas el rol ${needed.join(' o ')}.` });

      // --- Idempotency-Key requerida (♻️) ---
      const key = req.headers['idempotency-key'];
      if (op.idemRequired && !key) throw fail('VALIDATION_FAILED', { errors: [{ field: 'Idempotency-Key', pointer: '/headers/Idempotency-Key', code: 'REQUIRED', message: lang === 'en' ? 'The Idempotency-Key header is required.' : 'La cabecera Idempotency-Key es obligatoria.' }] });

      // --- query paging ---
      const limitRaw = req.query?.limit;
      let limit = 20;
      if (limitRaw !== undefined) {
        limit = Number(limitRaw);
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw fail('VALIDATION_FAILED', { errors: [fieldError('limit', 'OUT_OF_RANGE', lang, '/limit')] });
      }

      // --- validación del cuerpo contra el esquema del contrato ---
      let body = req.body;
      if (op.method !== 'GET' && Buffer.isBuffer(body)) body = undefined;
      if (op.bodySchema() && !(BODY_OPTIONAL.has(op.id) && (body === undefined || Object.keys(body ?? {}).length === 0))) {
        if (body === undefined || body === null) {
          if (op.bodyRequired) throw fail('VALIDATION_FAILED', { errors: [fieldError('(body)', 'REQUIRED', lang, '/')] });
        } else {
          if (!bodyValidators.has(op.id)) bodyValidators.set(op.id, compile(op.bodySchema(), `req:${op.id}`));
          const validate = bodyValidators.get(op.id);
          if (!validate(body)) throw fail('VALIDATION_FAILED', { errors: ajvErrorsToFields(validate.errors, lang) });
        }
      }

      // --- idempotencia ---
      const mutating = op.method !== 'GET';
      let rec = null;
      let ik = null;
      if (mutating && key) {
        ik = `${user?.id ?? 'anon'}|${op.method}|${req.url.split('?')[0]}|${key}`;
        const hash = createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
        const prev = db.idempotency.get(ik);
        if (prev) {
          if (prev.hash !== hash) throw fail('IDEMPOTENCY_KEY_REUSED');
          if (prev.pending) throw fail('IDEMPOTENCY_IN_PROGRESS', { headers: { 'Retry-After': '1' } });
          reply.header('Idempotent-Replayed', 'true');
          for (const [k, v] of Object.entries(prev.headers)) reply.header(k, v);
          return send(reply, prev.status, prev.body);
        }
        rec = { hash, pending: true };
        db.idempotency.set(ik, rec);
      }

      const c = {
        req, user, body, params: req.params, query: req.query ?? {}, lang, limit, cursor: req.query?.cursor, op,
        client: ['web', 'admin', 'native'].includes(req.headers['x-bandada-client']) ? req.headers['x-bandada-client'] : 'native',
        cookie: (name) => /* cookies simples */ (req.headers.cookie ?? '').split(/;\s*/).map((p) => p.split('=')).find(([k]) => k === name)?.[1],
        hasRole: (...roles) => !!user && roles.some((r) => user.roles.includes(r)),
        requireRole: (...roles) => { if (!user || !roles.some((r) => user.roles.includes(r))) throw fail('FORBIDDEN', { detail: lang === 'en' ? `You need the role ${roles.join(' or ')}.` : `Necesitas el rol ${roles.join(' o ')}.` }); },
        page: (items, keyFn, order = 'desc') => paginate(items, { cursor: req.query?.cursor, limit }, keyFn, order),
        notFound: (what) => fail('NOT_FOUND', what ? { detail: lang === 'en' ? `${what} not found.` : `${what} no encontrado.` } : undefined),
        isStaff: () => isStaff(user),
      };
      let out;
      try {
        out = await handler(c);
      } catch (e) {
        if (rec) db.idempotency.delete(ik);
        throw e;
      }
      let status = op.successStatus, headers = {};
      let payload = out;
      if (out?.__res) ({ status, body: payload, headers } = out);
      else if (out === undefined || out === null) { payload = undefined; if (status !== 204) status = 204; }
      if (mutating && key) reply.header('Idempotent-Replayed', 'false');
      const saved = {};
      for (const [k, v] of Object.entries(headers)) { reply.header(k, v); if (['Location', 'Retry-After'].includes(k)) saved[k] = v; }
      if (rec) {
        if (status < 300) { Object.assign(rec, { pending: false, status, body: payload, headers: saved }); } else db.idempotency.delete(ik);
      }
      return send(reply, status, payload);
    } catch (e) {
      if (e instanceof ApiError) return sendProblem(req, reply, e);
      throw e;
    }
  };
}

function send(reply, status, payload) {
  if (status === 204 || payload === undefined) return reply.code(status).send();
  return reply.code(status).type('application/json; charset=utf-8').send(JSON.stringify(payload));
}
