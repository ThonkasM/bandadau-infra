import { readFileSync } from 'node:fs';
import { GraphQLError, execute, parse, validate } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { MapperKind, getDirective, mapSchema } from '@graphql-tools/utils';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/use/ws';
import { QUEUE_TICK_MS } from './config.mjs';
import { pickLang } from './errors.mjs';
import { bus, emitQueue, ledgerPost, notify, postOfComment, queueItems, retrySaga, setMediaStatus, toEvent, toMediaAsset, toSaga, sagaOf, openReportsFor, walletOf } from './domain.mjs';
import { asset, db } from './state.mjs';
import { SDL_PATH } from './spec.mjs';
import { fid, now, uuid, verifyJwt } from './util.mjs';

const PHASE2 = new Set(['reports', 'report', 'alerts', 'agentRuns', 'requestReport', 'acknowledgeAlert', 'runMonitoringNow', 'createMcpToken', 'revokeMcpToken', 'alertRaised', 'reportReady']);
const gqlError = (message, code) => new GraphQLError(message, { extensions: { code } });
const MSG = {
  es: { NOT_FOUND: 'No existe el recurso indicado.', FORBIDDEN: 'No tienes permiso para esta acción.', LAST_ADMIN: 'No se puede quitar el rol al último administrador.', CANNOT_SUSPEND_SELF: 'No puedes suspenderte a ti mismo.', INVALID_STATUS_TRANSITION: 'El estado actual no permite esta transición.', UNIVERSITY_DOMAIN_TAKEN: 'Ese dominio ya pertenece a otra universidad.', MEDIA_NOT_FLAGGED: 'El medio no está pendiente de revisión.', SAGA_NOT_RETRYABLE: 'Solo se pueden reintentar SAGAs en estado FAILED.', VALIDATION_FAILED: 'Datos inválidos.' },
  en: { NOT_FOUND: 'The resource does not exist.', FORBIDDEN: 'You are not allowed to do this.', LAST_ADMIN: 'The last administrator cannot lose the role.', CANNOT_SUSPEND_SELF: 'You cannot suspend yourself.', INVALID_STATUS_TRANSITION: 'The current state does not allow this transition.', UNIVERSITY_DOMAIN_TAKEN: 'That domain already belongs to another university.', MEDIA_NOT_FLAGGED: 'The media item is not pending review.', SAGA_NOT_RETRYABLE: 'Only FAILED sagas can be retried.', VALIDATION_FAILED: 'Invalid data.' },
};
const uerr = (ctx, code, field) => [{ code, message: MSG[ctx.lang][code] ?? code, field: field ?? null }];

// ----------------------------------------------------------------- mapeos a tipos GraphQL
const gMedia = (m) => m && {
  id: m.id, owner: db.users.get(m.ownerId), kind: m.kind, purpose: m.purpose, status: m.status, previewUrl: asset(m.path), thumbnailUrl: asset(m.path), tags: m.tags, ocrText: m.ocrText,
  moderation: m.moderation && { decision: m.moderation.decision, labels: m.moderation.labels, scores: m.moderation.scores, maxScore: Math.max(0, ...Object.entries(m.moderation.scores).filter(([k]) => k !== 'safe').map(([, v]) => v)), modelVersion: m.moderation.modelVersion },
  createdAt: m.createdAt,
};
const gPost = (p) => p && { id: p.id, author: db.users.get(p.authorId), text: p.text, hashtags: p.hashtags, visibility: p.visibility, status: p.status, media: p.mediaIds.map((id) => gMedia(db.media.get(id))).filter(Boolean), createdAt: p.createdAt };
const gItem = (i) => ({ id: i.id, source: i.source, media: i.mediaId ? gMedia(db.media.get(i.mediaId)) : null, post: gPost(db.posts.get(i.postId)), openReports: i.openReports, enqueuedAt: i.enqueuedAt });
const gReport = (r) => ({ ...r, post: gPost(r.targetType === 'POST' ? db.posts.get(r.targetId) : postOfComment(r.targetId)), reporter: db.users.get(r.reporterId), resolvedBy: r.resolvedBy ? db.users.get(r.resolvedBy) : null });
const gRegistration = (r) => ({ id: r.id, eventId: r.eventId, user: db.users.get(r.userId), status: r.status, failureReason: r.failureReason, saga: [...db.sagas.values()].filter((s) => s.registrationId === r.id).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0] ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt });
const gEvent = (e) => ({ ...toEvent(e), organizer: db.users.get(e.organizerId) });

const b64 = (s) => Buffer.from(s).toString('base64url');
const offsetOf = (after) => { if (!after) return 0; const m = /^o:(\d+)$/.exec(Buffer.from(after, 'base64url').toString()); return m ? Number(m[1]) + 1 : 0; };
function connection(all, { after, first }, mapNode) {
  const start = offsetOf(after);
  const n = Math.min(Math.max(first ?? 20, 1), 50);
  const slice = all.slice(start, start + n);
  const edges = slice.map((x, i) => ({ cursor: b64(`o:${start + i}`), node: mapNode(x) }));
  return { edges, pageInfo: { hasNextPage: start + n < all.length, hasPreviousPage: start > 0, startCursor: edges[0]?.cursor ?? null, endCursor: edges.at(-1)?.cursor ?? null }, totalCount: all.length };
}
const cap = (n) => Math.min(Math.max(n ?? 50, 1), 50);

// ----------------------------------------------------------------- métricas simuladas coherentes
const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; };
const days = (from, to) => { const out = []; for (let t = Date.parse(from); t <= Date.parse(to) && out.length < 366; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const ledgerOn = (day, type) => db.ledger.filter((e) => e.type === type && e.createdAt.slice(0, 10) === day).reduce((s, e) => s + e.amountCredits, 0);
const todayStr = () => new Date().toISOString().slice(0, 10);
const bucketKey = (day, bucket) => {
  if (bucket === 'MONTH') return day.slice(0, 7) + '-01';
  if (bucket === 'WEEK') { const d = new Date(day); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); }
  return day;
};
function dayMetrics(day) {
  const posts = Math.round(8 + hash(day + 'p') * 22) + [...db.posts.values()].filter((p) => p.createdAt.slice(0, 10) === day).length;
  return {
    newUsers: Math.round(2 + hash(day + 'u') * 9),
    posts,
    registrationsConfirmed: Math.round(hash(day + 'r') * 14) + [...db.registrations.values()].filter((r) => r.confirmedAt?.slice(0, 10) === day).length,
    creditsSpent: Math.round(hash(day + 's') * 140) + ledgerOn(day, 'DEBIT'),
    topUp: Math.round(hash(day + 't') * 200) + ledgerOn(day, 'TOPUP'),
    refund: Math.round(hash(day + 'f') * 30) + ledgerOn(day, 'REFUND'),
  };
}

function health() {
  const svc = (name, status, latencyMs, checks) => ({ name, status, latencyMs, checks, error: status === 'UP' ? null : 'Consumidor de RabbitMQ con retraso (simulado).' });
  return {
    checkedAt: now(), overall: 'DEGRADED',
    services: [
      svc('identity-service', 'UP', 12, { db: 'UP' }), svc('social-service', 'UP', 18, { db: 'UP', broker: 'UP' }), svc('media-service', 'UP', 21, { db: 'UP', storage: 'UP' }),
      svc('events-service', 'UP', 15, { db: 'UP', broker: 'UP' }), svc('wallet-service', 'UP', 17, { db: 'UP', broker: 'UP' }), svc('ticketing-service', 'UP', 25, { dynamodb: 'UP' }),
      svc('notification-service', 'DEGRADED', 240, { dynamodb: 'UP', broker: 'DEGRADED' }), svc('admin-gateway', 'UP', 3, { upstreams: 'UP' }),
    ],
    queues: [
      { name: 'notification.events.q', messagesReady: 14, messagesUnacked: 2, consumers: 1, isDeadLetter: false },
      { name: 'social.moderation.q', messagesReady: 0, messagesUnacked: 0, consumers: 1, isDeadLetter: false },
      { name: 'events.saga.q', messagesReady: 0, messagesUnacked: 0, consumers: 1, isDeadLetter: false },
      { name: 'notification.events.dlq', messagesReady: 3, messagesUnacked: 0, consumers: 0, isDeadLetter: true },
    ],
  };
}

// ----------------------------------------------------------------- resolvers
const resolvers = {
  Query: {
    me: (_, __, ctx) => ctx.user,
    dashboard: (_, { range }) => {
      const ds = days(range.from, range.to);
      const m = ds.map((d) => [d, dayMetrics(d)]);
      const sum = (k) => m.reduce((s, [, x]) => s + x[k], 0);
      const names = ['newUsers', 'posts', 'registrationsConfirmed', 'creditsSpent'];
      return {
        range: { from: range.from, to: range.to }, activeUsers: [...db.users.values()].filter((u) => u.status === 'ACTIVE').length * 12, newUsers: sum('newUsers'), posts: sum('posts'),
        comments: Math.round(sum('posts') * 2.4), reactions: Math.round(sum('posts') * 6.1), registrationsConfirmed: sum('registrationsConfirmed'),
        registrationsFailed: Math.round(sum('registrationsConfirmed') * 0.06) + [...db.registrations.values()].filter((r) => r.status === 'FAILED').length,
        registrationsCancelled: Math.round(sum('registrationsConfirmed') * 0.04), creditsToppedUp: sum('topUp'), creditsSpent: sum('creditsSpent'), flaggedContent: queueItems().length, openAlerts: 0,
        series: names.map((name) => ({ name, points: m.map(([date, x]) => ({ date, value: x[name] })) })),
      };
    },
    users: (_, { filter, after, first }) => {
      let list = [...db.users.values()];
      if (filter?.query) { const q = filter.query.toLowerCase(); list = list.filter((u) => u.email.includes(q) || u.displayName.toLowerCase().includes(q)); }
      if (filter?.role) list = list.filter((u) => u.roles.includes(filter.role));
      if (filter?.status) list = list.filter((u) => u.status === filter.status);
      if (filter?.universityId) list = list.filter((u) => u.universityId === filter.universityId);
      list.sort((a, b) => (a.createdAt === b.createdAt ? (a.email < b.email ? -1 : 1) : a.createdAt < b.createdAt ? 1 : -1));
      return connection(list, { after, first }, (u) => u);
    },
    user: (_, { id }) => db.users.get(id) ?? null,
    universities: () => [...db.universities.values()],
    moderationQueue: (_, { filter, after, first }) => {
      let list = queueItems();
      if (filter?.source) list = list.filter((i) => i.source === filter.source);
      if (filter?.kind) list = list.filter((i) => i.mediaId && db.media.get(i.mediaId).kind === filter.kind);
      if (filter?.minScore != null) list = list.filter((i) => i.mediaId && (gMedia(db.media.get(i.mediaId)).moderation?.maxScore ?? 0) >= filter.minScore);
      list.sort((a, b) => (a.enqueuedAt === b.enqueuedAt ? (a.id < b.id ? -1 : 1) : a.enqueuedAt < b.enqueuedAt ? -1 : 1));
      return connection(list, { after, first }, gItem);
    },
    contentReports: (_, { status, targetType, first }) =>
      [...db.reports.values()].filter((r) => r.status === status && (!targetType || r.targetType === targetType)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, cap(first)).map(gReport),
    events: (_, { filter, first }) => {
      let list = [...db.events.values()];
      if (filter?.status) list = list.filter((e) => e.status === filter.status);
      if (filter?.organizerId) list = list.filter((e) => e.organizerId === filter.organizerId);
      if (filter?.from) list = list.filter((e) => e.startsAt >= filter.from);
      if (filter?.to) list = list.filter((e) => e.startsAt <= filter.to);
      if (filter?.query) list = list.filter((e) => e.title.toLowerCase().includes(filter.query.toLowerCase()));
      return list.sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1)).slice(0, cap(first)).map(gEvent);
    },
    event: (_, { id }) => (db.events.get(id) ? gEvent(db.events.get(id)) : null),
    registrations: (_, { eventId, status, first }) =>
      [...db.registrations.values()].filter((r) => r.eventId === eventId && (!status || r.status === status)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, cap(first)).map(gRegistration),
    sagas: (_, { status, type, since, first }) =>
      [...db.sagas.values()].filter((s) => (!status || s.status === status) && (!type || s.type === type) && (!since || s.updatedAt >= since)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, cap(first)).map(toSaga),
    walletStats: (_, { range }) => {
      const bucket = range.bucket ?? 'DAY';
      const byBucket = new Map();
      for (const d of days(range.from, range.to)) {
        const x = dayMetrics(d);
        const k = bucketKey(d, bucket);
        const cur = byBucket.get(k) ?? { date: k, topUpCredits: 0, debitCredits: 0, refundCredits: 0 };
        cur.topUpCredits += x.topUp; cur.debitCredits += x.creditsSpent; cur.refundCredits += x.refund;
        byBucket.set(k, cur);
      }
      const series = [...byBucket.values()];
      const tot = (k) => series.reduce((s, p) => s + p[k], 0);
      return {
        range: { from: range.from, to: range.to }, topUpCount: Math.round(tot('topUpCredits') / 35), topUpCredits: tot('topUpCredits'), debitCount: Math.round(tot('debitCredits') / 18), debitCredits: tot('debitCredits'),
        refundCount: Math.round(tot('refundCredits') / 15), refundCredits: tot('refundCredits'), netCredits: tot('topUpCredits') - tot('debitCredits') + tot('refundCredits'),
        circulatingCredits: [...db.wallets.values()].reduce((s, w) => s + w.balanceCredits, 0), series,
      };
    },
    serviceHealth: () => health(),
  },

  Mutation: {
    updateUserRoles: (_, { input }, ctx) => {
      const u = db.users.get(input.userId);
      if (!u) return { user: null, errors: uerr(ctx, 'NOT_FOUND', ['input', 'userId']) };
      if (input.roles.length === 0) return { user: null, errors: uerr(ctx, 'VALIDATION_FAILED', ['input', 'roles']) };
      if (u.roles.includes('ADMIN') && !input.roles.includes('ADMIN') && [...db.users.values()].filter((x) => x.roles.includes('ADMIN') && x.status === 'ACTIVE').length <= 1) return { user: null, errors: uerr(ctx, 'LAST_ADMIN', ['input', 'roles']) };
      u.roles = [...new Set(input.roles)]; u.updatedAt = now();
      return { user: u, errors: [] };
    },
    suspendUser: (_, { input }, ctx) => {
      const u = db.users.get(input.userId);
      if (!u) return { user: null, errors: uerr(ctx, 'NOT_FOUND', ['input', 'userId']) };
      if (u.id === ctx.user.id) return { user: null, errors: uerr(ctx, 'CANNOT_SUSPEND_SELF', ['input', 'userId']) };
      if (!ctx.user.roles.includes('ADMIN') && (u.roles.includes('ADMIN') || u.roles.includes('MODERATOR'))) return { user: null, errors: uerr(ctx, 'FORBIDDEN', ['input', 'userId']) };
      if (u.status !== 'ACTIVE') return { user: null, errors: uerr(ctx, 'INVALID_STATUS_TRANSITION', ['input', 'userId']) };
      Object.assign(u, { status: 'SUSPENDED', suspendedAt: now(), suspensionReason: input.reason, suspendedUntil: input.until ?? null, updatedAt: now() });
      for (const r of db.refreshTokens.values()) if (r.userId === u.id) r.revoked = true;
      return { user: u, errors: [] };
    },
    reactivateUser: (_, { input }, ctx) => {
      const u = db.users.get(input.userId);
      if (!u) return { user: null, errors: uerr(ctx, 'NOT_FOUND', ['input', 'userId']) };
      if (u.status !== 'SUSPENDED') return { user: null, errors: uerr(ctx, 'INVALID_STATUS_TRANSITION', ['input', 'userId']) };
      Object.assign(u, { status: 'ACTIVE', suspendedAt: null, suspensionReason: null, suspendedUntil: null, updatedAt: now() });
      return { user: u, errors: [] };
    },
    createUniversity: (_, { input }, ctx) => {
      const domains = input.allowedDomains.map((d) => d.toLowerCase());
      if ([...db.universities.values()].some((x) => x.allowedDomains.some((d) => domains.includes(d)))) return { university: null, errors: uerr(ctx, 'UNIVERSITY_DOMAIN_TAKEN', ['input', 'allowedDomains']) };
      const uni = { id: uuid(), name: input.name, allowedDomains: domains, enabled: true, createdAt: now() };
      db.universities.set(uni.id, uni);
      return { university: uni, errors: [] };
    },
    moderateMedia: (_, { id, decision, note }, ctx) => {
      const m = db.media.get(id);
      if (!m) return { media: null, errors: uerr(ctx, 'NOT_FOUND', ['id']) };
      if (m.status !== 'FLAGGED') return { media: gMedia(m), errors: uerr(ctx, 'MEDIA_NOT_FLAGGED', ['id']) };
      setMediaStatus(m, decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', { decision, note, by: ctx.user.id });
      return { media: gMedia(m), errors: [] };
    },
    resolveContentReport: (_, { input }, ctx) => {
      const r = db.reports.get(input.reportId);
      if (!r) return { report: null, errors: uerr(ctx, 'NOT_FOUND', ['input', 'reportId']) };
      if (r.status !== 'OPEN') return { report: gReport(r), errors: uerr(ctx, 'INVALID_STATUS_TRANSITION', ['input', 'reportId']) };
      const post = r.targetType === 'POST' ? db.posts.get(r.targetId) : postOfComment(r.targetId);
      const snapshot = post && queueItems().find((i) => i.source === 'REPORTS' && i.id === post.id);
      const group = [...db.reports.values()].filter((x) => x.status === 'OPEN' && x.targetId === r.targetId);
      for (const x of group) Object.assign(x, { status: input.resolution === 'KEEP' ? 'RESOLVED_KEPT' : 'RESOLVED_REMOVED', resolution: input.resolution, resolutionNote: input.note ?? null, resolvedAt: now(), resolvedBy: ctx.user.id });
      if (input.resolution === 'REMOVE') {
        if (r.targetType === 'POST' && post) Object.assign(post, { status: 'REMOVED', hiddenReason: 'MODERATOR', updatedAt: now() });
        if (r.targetType === 'COMMENT') { const cm = db.comments.get(post?.id)?.find((c) => c.id === r.targetId); if (cm) cm.status = 'REMOVED'; }
      } else if (post && post.status === 'HIDDEN' && post.hiddenReason === 'REPORTED' && openReportsFor(post.id).length === 0) {
        Object.assign(post, { status: 'PUBLISHED', hiddenReason: null, updatedAt: now() });
      }
      if (snapshot && openReportsFor(post.id).length === 0) emitQueue('RESOLVED', snapshot);
      return { report: gReport(r), errors: [] };
    },
    retrySaga: (_, { id }, ctx) => {
      const s = db.sagas.get(id);
      if (!s) return { saga: null, errors: uerr(ctx, 'NOT_FOUND', ['id']) };
      if (s.status !== 'FAILED') return { saga: toSaga(s), errors: uerr(ctx, 'SAGA_NOT_RETRYABLE', ['id']) };
      return { saga: toSaga(retrySaga(s)), errors: [] };
    },
  },

  Subscription: {
    moderationQueueChanged: {
      subscribe: () => busIterator('moderationQueue'),
      resolve: (p) => ({ type: p.type, item: gItem(p.item), totalCount: p.totalCount }),
    },
  },

  User: {
    university: (u) => db.universities.get(u.universityId) ?? null,
    suspendedAt: (u) => u.suspendedAt ?? null,
    suspensionReason: (u) => u.suspensionReason ?? null,
  },
  Event: { registrations: (e) => [...db.registrations.values()].filter((r) => r.eventId === e.id).map(gRegistration) },
};

// iterador asíncrono sobre el bus (cola de eventos + resolución pendiente)
function busIterator(topic) {
  const queue = [];
  let wake = null;
  let done = false;
  const on = (ev) => { queue.push(ev); wake?.(); };
  bus.on(topic, on);
  ticker.add();
  const cleanup = () => { if (done) return; done = true; bus.off(topic, on); ticker.remove(); wake?.(); };
  return {
    [Symbol.asyncIterator]() { return this; },
    async next() {
      while (!done) {
        if (queue.length) return { value: queue.shift(), done: false };
        await new Promise((r) => (wake = r));
      }
      return { value: undefined, done: true };
    },
    async return() { cleanup(); return { value: undefined, done: true }; },
    async throw(e) { cleanup(); throw e; },
  };
}

// Cambio simulado cada QUEUE_TICK_MS mientras haya suscriptores.
const ticker = (() => {
  let n = 0, timer = null;
  const tick = () => {
    const ai = queueItems().filter((i) => i.source === 'AI');
    if (ai.length >= 8) {
      const oldest = ai.sort((a, b) => (a.enqueuedAt < b.enqueuedAt ? -1 : 1))[0];
      setMediaStatus(db.media.get(oldest.id), 'APPROVED', { decision: 'APPROVE', note: 'Aprobado por otro moderador (simulado).', by: db.keyToId.mod });
      return;
    }
    const owners = ['lucia', 'marco', 'camila', 'diego', 'valeria', 'andres', 'sofia'];
    const owner = db.keyToId[owners[n % owners.length]];
    const mid = uuid();
    const score = 0.6 + ((n * 7) % 35) / 100;
    db.media.set(mid, { id: mid, ownerId: owner, kind: 'IMAGE', purpose: 'POST', mimeType: 'image/png', sizeBytes: 52_000, durationSeconds: null, status: 'PROCESSING', path: `/mock-assets/flagged/${(n % 3) + 1}.png`, tags: ['nsfw'], ocrText: null, createdAt: now(), updatedAt: now(), fileName: '', moderation: { model: 'mock-nsfw', modelVersion: '0.0.1-mock', labels: ['nsfw'], scores: { nsfw: +score.toFixed(2), safe: +(1 - score).toFixed(2) }, decision: 'REVIEW', frameIndex: null, createdAt: now(), finalDecision: null } });
    const pid = uuid();
    db.posts.set(pid, { id: pid, clientId: uuid(), authorId: owner, text: 'Publicación simulada con imagen en revisión. #mock', hashtags: ['mock'], visibility: 'PUBLIC', groupId: null, status: 'PENDING_MEDIA', hiddenReason: null, mediaIds: [mid], createdAt: now(), updatedAt: now() });
    db.comments.set(pid, []); db.reactions.set(pid, new Map());
    n++;
    setMediaStatus(db.media.get(mid), 'FLAGGED');
  };
  let subs = 0;
  return {
    add() { if (++subs === 1 && QUEUE_TICK_MS > 0) { timer = setInterval(tick, QUEUE_TICK_MS); timer.unref?.(); } },
    remove() { if (--subs <= 0) { subs = 0; clearInterval(timer); timer = null; } },
    tick,
  };
})();
export const simulateQueueChange = () => ticker.tick();

// ----------------------------------------------------------------- esquema + @auth
export function buildSchema() {
  const typeDefs = readFileSync(SDL_PATH, 'utf8');
  let schema = makeExecutableSchema({ typeDefs, resolvers, resolverValidationOptions: { requireResolversToMatchSchema: 'ignore' } });
  schema = mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig, fieldName, typeName) => {
      const requires = getDirective(schema, fieldConfig, 'auth')?.[0]?.requires;
      if (!requires && !PHASE2.has(fieldName)) return fieldConfig;
      const guard = (ctx) => {
        if (requires) {
          if (!ctx.user) throw gqlError('No autenticado.', 'UNAUTHENTICATED');
          if (!requires.some((r) => ctx.user.roles.includes(r))) throw gqlError(`Se requiere el rol ${requires.join(' o ')}.`, 'FORBIDDEN');
        }
        if (PHASE2.has(fieldName) && ['Query', 'Mutation', 'Subscription'].includes(typeName)) throw gqlError('Función de la fase 2, deshabilitada en el mock.', 'FEATURE_DISABLED');
      };
      if (typeName === 'Subscription') {
        const sub = fieldConfig.subscribe;
        return { ...fieldConfig, subscribe: (src, args, ctx, info) => { guard(ctx); return sub(src, args, ctx, info); } };
      }
      const orig = fieldConfig.resolve ?? ((src) => src?.[fieldName]);
      return { ...fieldConfig, resolve: (src, args, ctx, info) => { guard(ctx); return orig(src, args, ctx, info); } };
    },
  });
  return schema;
}

const userFromAuth = (header) => {
  const token = /^Bearer (.+)$/i.exec(header ?? '')?.[1];
  const claims = token && verifyJwt(token);
  const u = claims && db.users.get(claims.sub);
  return u && u.status === 'ACTIVE' ? u : null;
};

export async function registerGraphql(app) {
  const schema = buildSchema();
  app.decorate('gqlSchema', schema);
  const handle = async (req, reply) => {
    const src = req.method === 'GET' ? req.query : req.body ?? {};
    let variables = src.variables;
    if (typeof variables === 'string') { try { variables = JSON.parse(variables); } catch { variables = undefined; } }
    if (!src.query) return reply.code(400).send({ errors: [{ message: 'Falta el campo query.', extensions: { code: 'BAD_REQUEST' } }] });
    let document;
    try { document = parse(src.query); } catch (e) { return reply.code(400).send({ errors: [{ message: e.message, extensions: { code: 'GRAPHQL_PARSE_FAILED' } }] }); }
    const errors = validate(schema, document);
    if (errors.length) return reply.code(400).send({ errors: errors.map((e) => ({ message: e.message, locations: e.locations, extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } })) });
    const op = document.definitions.find((d) => d.kind === 'OperationDefinition' && (!src.operationName || d.name?.value === src.operationName));
    if (op?.operation === 'subscription') return reply.code(400).send({ errors: [{ message: 'Las suscripciones usan WebSocket (graphql-transport-ws) en /graphql.', extensions: { code: 'BAD_REQUEST' } }] });
    if (op?.operation === 'mutation' && req.method === 'GET') return reply.code(405).send({ errors: [{ message: 'Las mutaciones requieren POST.', extensions: { code: 'METHOD_NOT_ALLOWED' } }] });
    const result = await execute({ schema, document, variableValues: variables, operationName: src.operationName, contextValue: { user: userFromAuth(req.headers.authorization), lang: req.lang } });
    return reply.code(200).type('application/json; charset=utf-8').send(JSON.stringify(result));
  };
  app.post('/graphql', handle);
  app.get('/graphql', handle);

  app.addHook('onReady', async () => {
    const wss = new WebSocketServer({ noServer: true });
    app.server.on('upgrade', (req, socket, head) => {
      if (new URL(req.url, 'http://x').pathname !== '/graphql') return socket.destroy();
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    const server = useServer({
      schema,
      context: (ctx) => {
        const p = ctx.connectionParams ?? {};
        const url = new URL(ctx.extra.request.url, 'http://x');
        const auth = p.Authorization ?? p.authorization ?? (p.token ? `Bearer ${p.token}` : null) ?? (url.searchParams.get('token') ? `Bearer ${url.searchParams.get('token')}` : null);
        return { user: userFromAuth(auth), lang: pickLang(p['Accept-Language'] ?? p['accept-language'] ?? ctx.extra.request.headers['accept-language']) };
      },
    }, wss);
    app.addHook('onClose', async () => { await server.dispose(); wss.close(); });
  });
}
void fid; void ledgerPost; void notify; void toMediaAsset; void sagaOf; void walletOf; void gMedia;
