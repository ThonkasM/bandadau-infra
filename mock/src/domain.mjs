// Reglas de dominio compartidas (serializadores, billetera, SAGA, moderación) sobre el estado en memoria.
import { EventEmitter } from 'node:events';
import { generateKeyPairSync, sign as cSign, verify as cVerify } from 'node:crypto';
import { SAGA_STEP_MS } from './config.mjs';
import { asset, db, later, NS } from './state.mjs';
import { b64url, fid, iso, now, tail, uuid } from './util.mjs';

export const bus = new EventEmitter();
bus.setMaxListeners(100);

// ---------------------------------------------------------------- usuarios / perfiles
export const toUser = (u) => ({
  id: u.id, email: u.email, universityId: u.universityId, status: u.status, roles: u.roles, locale: u.locale, theme: u.theme,
  emailVerifiedAt: u.emailVerifiedAt, createdAt: u.createdAt, updatedAt: u.updatedAt,
});
export const summary = (userId) => {
  const u = db.users.get(userId);
  return { userId, displayName: u?.displayName ?? 'Usuario', avatarUrl: u?.avatarUrl ?? null };
};
export const countFollowers = (id) => [...db.follows.values()].filter((f) => f.followeeId === id).length;
export const countFollowing = (id) => [...db.follows.values()].filter((f) => f.followerId === id).length;
export const isFollowing = (a, b) => db.follows.has(`${a}>${b}`);
export function toProfile(u, viewerId) {
  return {
    userId: u.id, displayName: u.displayName, universityId: u.universityId, career: u.career, semester: u.semester, bio: u.bio,
    interests: u.interests, avatarMediaId: u.avatarMediaId, avatarUrl: u.avatarUrl, followersCount: countFollowers(u.id),
    followingCount: countFollowing(u.id), postsCount: [...db.posts.values()].filter((p) => p.authorId === u.id && p.status === 'PUBLISHED').length,
    followedByMe: viewerId ? isFollowing(viewerId, u.id) : false, createdAt: u.createdAt, updatedAt: u.updatedAt,
  };
}

// ---------------------------------------------------------------- notificaciones
const TPL = {
  WELCOME: { es: ['¡Bienvenido a Bandada U!', 'Completa tu perfil y empieza a seguir a tu comunidad.'], en: ['Welcome to Bandada U!', 'Complete your profile and start following your community.'] },
  REGISTRATION_CONFIRMED: { es: ['Inscripción confirmada', 'Ya tienes tu entrada para {event}.'], en: ['Registration confirmed', 'You now have your ticket for {event}.'] },
  REGISTRATION_FAILED: { es: ['No pudimos completar tu inscripción', '{event}: {reason}'], en: ['We could not complete your registration', '{event}: {reason}'] },
  REGISTRATION_CANCELLED: { es: ['Inscripción cancelada', 'Cancelamos tu inscripción a {event} y reembolsamos tus créditos.'], en: ['Registration cancelled', 'We cancelled your registration to {event} and refunded your credits.'] },
  EVENT_CANCELLED: { es: ['Evento cancelado', '{event} fue cancelado por el organizador.'], en: ['Event cancelled', '{event} was cancelled by the organizer.'] },
  TOPUP_PAID: { es: ['Recarga acreditada', 'Se acreditaron {credits} créditos a tu billetera.'], en: ['Top-up credited', '{credits} credits were added to your wallet.'] },
  NEW_FOLLOWER: { es: ['Nuevo seguidor', '{name} empezó a seguirte.'], en: ['New follower', '{name} started following you.'] },
  NEW_COMMENT: { es: ['Nuevo comentario', '{name} comentó tu publicación.'], en: ['New comment', '{name} commented on your post.'] },
  NEW_REACTION: { es: ['Nueva reacción', '{name} reaccionó a tu publicación.'], en: ['New reaction', '{name} reacted to your post.'] },
  GROUP_REQUEST: { es: ['Solicitud de ingreso', '{name} quiere unirse a {group}.'], en: ['Join request', '{name} wants to join {group}.'] },
  CONTENT_FLAGGED: { es: ['Contenido en revisión', 'Una de tus imágenes quedó en revisión de moderación.'], en: ['Content under review', 'One of your images is under moderation review.'] },
};
const REASON = { es: { INSUFFICIENT_FUNDS: 'saldo insuficiente', TICKET_ISSUE_FAILED: 'no se pudo emitir la entrada', EVENT_FULL: 'el evento se llenó', TIMEOUT: 'la operación tardó demasiado' }, en: { INSUFFICIENT_FUNDS: 'insufficient funds', TICKET_ISSUE_FAILED: 'the ticket could not be issued', EVENT_FULL: 'the event is full', TIMEOUT: 'the operation timed out' } };
const fill = (s, p) => s.replace(/\{(\w+)\}/g, (_, k) => p[k] ?? '');
export function notify(userId, type, params = {}, deepLink = '/') {
  const u = db.users.get(userId);
  if (!u) return null;
  const lang = u.locale === 'en' ? 'en' : 'es';
  const p = { ...params, reason: REASON[lang][params.reason] ?? params.reason };
  const [title, body] = TPL[type][lang].map((s) => fill(s, p));
  const n = { id: uuid(), userId, type, title, body, locale: lang, data: { deepLink }, readAt: null, createdAt: now() };
  db.notifications.push(n);
  return n;
}

// ---------------------------------------------------------------- billetera
export const walletOf = (userId) => {
  let w = db.wallets.get(userId);
  if (!w) { w = { userId, balanceCredits: 0, updatedAt: now() }; db.wallets.set(userId, w); }
  return w;
};
/** Asienta una entrada del libro; idempotente por operationRef. */
export function ledgerPost(userId, type, amount, operationRef, description, extra = {}) {
  const dup = db.ledger.find((e) => e.operationRef === operationRef);
  if (dup) return dup;
  const w = walletOf(userId);
  w.balanceCredits += type === 'DEBIT' ? -amount : amount;
  w.updatedAt = now();
  const e = { id: uuid(), walletId: fid(NS.ledger + 100, tail(userId)), userId, type, amountCredits: amount, balanceAfterCredits: w.balanceCredits, operationRef, description, registrationId: null, eventId: null, topUpId: null, createdAt: now(), ...extra };
  db.ledger.push(e);
  return e;
}
export const toLedger = ({ userId, ...e }) => e;

// ---------------------------------------------------------------- tickets (ES256 real con clave efímera)
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const KID = 'tk-mock-1';
export const ticketJwk = () => ({ ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'ES256' });
export function signQr(t) {
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: KID }));
  const body = b64url(JSON.stringify({ tid: t.id, eid: t.eventId, rid: t.registrationId, sub: t.userId, iat: Math.floor(Date.parse(t.issuedAt) / 1000) }));
  const sig = cSign('sha256', Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64url(sig)}`;
}
export function verifyQr(qr) {
  const parts = String(qr).split('.');
  if (parts.length !== 3) return null;
  try {
    const ok = cVerify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'));
    return ok ? JSON.parse(Buffer.from(parts[1], 'base64url').toString()) : null;
  } catch { return null; }
}
export function toTicket(t) {
  const ev = db.events.get(t.eventId);
  return { id: t.id, registrationId: t.registrationId, eventId: t.eventId, userId: t.userId, eventTitle: ev?.title, eventStartsAt: ev?.startsAt, venue: ev?.venue, status: t.status, issuedAt: t.issuedAt, usedAt: t.usedAt, voidedAt: t.voidedAt };
}
export const toTicketDetail = (t) => ({ ...toTicket(t), qrPayload: signQr(t) });

// ---------------------------------------------------------------- eventos / inscripciones / SAGA
const ACTIVE = new Set(['PENDING', 'CONFIRMED', 'CANCELLATION_PENDING']);
export const seatsTaken = (ev) => ev.baseTaken + [...db.registrations.values()].filter((r) => r.eventId === ev.id && ACTIVE.has(r.status)).length;
export function toEvent(ev) {
  const taken = seatsTaken(ev);
  return { id: ev.id, organizerId: ev.organizerId, title: ev.title, description: ev.description, coverMediaId: null, coverUrl: ev.coverUrl, startsAt: ev.startsAt, venue: ev.venue, capacity: ev.capacity, seatsTaken: taken, seatsAvailable: Math.max(0, ev.capacity - taken), priceCredits: ev.priceCredits, status: ev.status, publishedAt: ev.publishedAt, createdAt: ev.createdAt, updatedAt: ev.updatedAt };
}
export function toRegistration(r) {
  const ev = db.events.get(r.eventId);
  return { id: r.id, eventId: r.eventId, userId: r.userId, event: { id: ev.id, title: ev.title, startsAt: ev.startsAt, venue: ev.venue }, status: r.status, failureReason: r.failureReason, priceCredits: r.priceCredits, ticketId: r.ticketId, createdAt: r.createdAt, updatedAt: r.updatedAt, confirmedAt: r.confirmedAt, cancelledAt: r.cancelledAt };
}
export const toSaga = (s) => ({ id: s.id, type: s.type, registrationId: s.registrationId, eventId: s.eventId, userId: s.userId, step: s.step, status: s.status, failureReason: s.failureReason, retries: s.retries, deadlineAt: s.deadlineAt, startedAt: s.startedAt, updatedAt: s.updatedAt, correlationId: s.correlationId });
export const sagaOf = (regId, type = 'REGISTRATION') => [...db.sagas.values()].find((s) => s.registrationId === regId && s.type === type);

const touch = (o) => { o.updatedAt = now(); return o; };
const setSaga = (s, patch) => Object.assign(s, patch, { updatedAt: now() });

function failRegistration(r, s, reason) {
  Object.assign(r, { status: 'FAILED', failureReason: reason });
  touch(r);
  setSaga(s, { status: 'COMPENSATED', step: 'RELEASE_SEAT', failureReason: reason });
  const ev = db.events.get(r.eventId);
  notify(r.userId, 'REGISTRATION_FAILED', { event: ev.title, reason }, `/registrations/${r.id}`);
}
function issueTicket(r, s) {
  const t = { id: uuid(), registrationId: r.id, eventId: r.eventId, userId: r.userId, status: 'ISSUED', issuedAt: now(), usedAt: null, voidedAt: null };
  db.tickets.set(t.id, t);
  Object.assign(r, { status: 'CONFIRMED', ticketId: t.id, confirmedAt: now(), failureReason: null });
  touch(r);
  setSaga(s, { status: 'COMPLETED', step: 'ISSUE_TICKET', failureReason: null });
  const ev = db.events.get(r.eventId);
  notify(r.userId, 'REGISTRATION_CONFIRMED', { event: ev.title }, `/tickets/${t.id}`);
}

/** PENDING → (0.5 s débito) → (1.0 s ticket) → (1.5 s) CONFIRMED | FAILED con compensación. */
export function startRegistrationSaga(r) {
  const s = { id: uuid(), type: 'REGISTRATION', registrationId: r.id, eventId: r.eventId, userId: r.userId, step: 'RESERVE_SEAT', status: 'STARTED', failureReason: null, retries: 0, deadlineAt: iso(Date.now() + 30_000), startedAt: now(), updatedAt: now(), correlationId: uuid() };
  db.sagas.set(s.id, s);
  const ev = db.events.get(r.eventId);
  later(SAGA_STEP_MS, () => {
    if (r.status !== 'PENDING') return;
    setSaga(s, { status: 'AWAITING_DEBIT', step: 'DEBIT_CREDITS' });
    if (r.priceCredits > 0) {
      if (walletOf(r.userId).balanceCredits < r.priceCredits) {
        setSaga(s, { status: 'COMPENSATING', step: 'RELEASE_SEAT', failureReason: 'INSUFFICIENT_FUNDS' });
        later(SAGA_STEP_MS, () => failRegistration(r, s, 'INSUFFICIENT_FUNDS'));
        return;
      }
      ledgerPost(r.userId, 'DEBIT', r.priceCredits, `DEBIT:${r.id}`, `Inscripción: ${ev.title}`, { registrationId: r.id, eventId: ev.id });
    }
    later(SAGA_STEP_MS, () => {
      setSaga(s, { status: 'AWAITING_TICKET', step: 'ISSUE_TICKET' });
      if (/CHAOS/i.test(ev.title)) {
        later(SAGA_STEP_MS, () => {
          setSaga(s, { status: 'COMPENSATING', step: 'REFUND_CREDITS', failureReason: 'TICKET_ISSUE_FAILED' });
          if (r.priceCredits > 0) ledgerPost(r.userId, 'REFUND', r.priceCredits, `REFUND:${r.id}`, `Reembolso: ${ev.title}`, { registrationId: r.id, eventId: ev.id });
          failRegistration(r, s, 'TICKET_ISSUE_FAILED');
        });
        return;
      }
      later(SAGA_STEP_MS, () => issueTicket(r, s));
    });
  });
  return s;
}

export function retrySaga(s) {
  const r = db.registrations.get(s.registrationId);
  setSaga(s, { status: 'AWAITING_TICKET', step: 'ISSUE_TICKET', retries: s.retries + 1, failureReason: null, deadlineAt: iso(Date.now() + 30_000) });
  later(SAGA_STEP_MS * 2, () => { if (s.status === 'AWAITING_TICKET') issueTicket(r, s); });
  return s;
}

/** Cancelación (por el usuario o por cancelación del evento): void ticket → reembolso → liberar cupo. */
export function startCancellation(r, notifyType = 'REGISTRATION_CANCELLED') {
  Object.assign(r, { status: 'CANCELLATION_PENDING' });
  touch(r);
  const s = { id: uuid(), type: 'CANCELLATION', registrationId: r.id, eventId: r.eventId, userId: r.userId, step: 'VOID_TICKET', status: 'STARTED', failureReason: null, retries: 0, deadlineAt: iso(Date.now() + 30_000), startedAt: now(), updatedAt: now(), correlationId: uuid() };
  db.sagas.set(s.id, s);
  const ev = db.events.get(r.eventId);
  later(SAGA_STEP_MS, () => {
    const t = r.ticketId && db.tickets.get(r.ticketId);
    if (t && t.status === 'ISSUED') Object.assign(t, { status: 'VOIDED', voidedAt: now() });
    setSaga(s, { status: 'COMPENSATING', step: 'REFUND_CREDITS' });
    if (r.priceCredits > 0 && db.ledger.some((e) => e.operationRef === `DEBIT:${r.id}`)) ledgerPost(r.userId, 'REFUND', r.priceCredits, `REFUND:${r.id}`, `Reembolso: ${ev.title}`, { registrationId: r.id, eventId: ev.id });
    later(SAGA_STEP_MS, () => {
      Object.assign(r, { status: 'CANCELLED', cancelledAt: now() });
      touch(r);
      setSaga(s, { status: 'COMPLETED', step: 'RELEASE_SEAT' });
      notify(r.userId, notifyType, { event: ev.title }, `/registrations/${r.id}`);
    });
  });
  return s;
}

// ---------------------------------------------------------------- posts / medios / moderación
export const toMediaAsset = (m) => ({
  id: m.id, ownerId: m.ownerId, kind: m.kind, purpose: m.purpose, mimeType: m.mimeType, sizeBytes: m.sizeBytes, durationSeconds: m.durationSeconds,
  status: m.status, url: m.status === 'APPROVED' ? asset(m.path) : null, thumbnailUrl: m.status === 'APPROVED' ? asset(m.path) : null,
  tags: m.tags, ocrText: m.ocrText, createdAt: m.createdAt, updatedAt: m.updatedAt,
});
export const toModeratedMedia = (m) => ({
  ...toMediaAsset(m), url: asset(m.path), thumbnailUrl: asset(m.path),
  moderationResults: m.moderation ? [{ model: m.moderation.model, modelVersion: m.moderation.modelVersion, labels: m.moderation.labels, scores: m.moderation.scores, decision: m.moderation.decision, frameIndex: m.moderation.frameIndex, createdAt: m.moderation.createdAt }] : [],
  finalDecision: m.moderation?.finalDecision ?? null,
});
export const reactionCounts = (postId) => {
  const c = { like: 0, helpful: 0, funny: 0, support: 0 };
  for (const t of db.reactions.get(postId)?.values() ?? []) c[t.toLowerCase()]++;
  return c;
};
export const isMember = (groupId, userId) => db.memberships.get(`${groupId}:${userId}`)?.status === 'ACTIVE';
export const isStaff = (u) => u?.roles?.some((r) => r === 'ADMIN' || r === 'MODERATOR');
export function canSeePost(p, viewer) {
  if (!viewer) return false;
  if (p.authorId === viewer.id) return p.status !== 'REMOVED' || isStaff(viewer);
  if (isStaff(viewer)) return true;
  if (p.status !== 'PUBLISHED') return false;
  if (p.visibility === 'PUBLIC') return true;
  if (p.visibility === 'FOLLOWERS') return isFollowing(viewer.id, p.authorId);
  return isMember(p.groupId, viewer.id);
}
export function toPost(p, viewerId) {
  const media = p.mediaIds.map((id) => db.media.get(id)).filter(Boolean).map((m) => ({ mediaId: m.id, kind: m.kind, status: m.status, url: m.status === 'APPROVED' ? asset(m.path) : null, thumbnailUrl: m.status === 'APPROVED' ? asset(m.path) : null }));
  return {
    id: p.id, clientId: p.clientId, authorId: p.authorId, author: summary(p.authorId), text: p.text, hashtags: p.hashtags, visibility: p.visibility, groupId: p.groupId,
    status: p.status, media, reactionCounts: reactionCounts(p.id), commentsCount: (db.comments.get(p.id) ?? []).filter((c) => c.status === 'VISIBLE').length,
    myReaction: viewerId ? db.reactions.get(p.id)?.get(viewerId) ?? null : null, createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}
export const openReportsFor = (postId) => [...db.reports.values()].filter((r) => r.status === 'OPEN' && (r.targetType === 'POST' ? r.targetId === postId : postOfComment(r.targetId)?.id === postId));
export const postOfComment = (cid) => { for (const [pid, list] of db.comments) if (list.some((c) => c.id === cid)) return db.posts.get(pid); return null; };

export function queueItems() {
  const items = [];
  for (const m of db.media.values()) {
    if (m.status !== 'FLAGGED') continue;
    const post = [...db.posts.values()].find((p) => p.mediaIds.includes(m.id));
    items.push({ id: m.id, source: 'AI', mediaId: m.id, postId: post?.id ?? null, openReports: post ? openReportsFor(post.id).length : 0, enqueuedAt: m.updatedAt });
  }
  const seen = new Set();
  for (const r of db.reports.values()) {
    if (r.status !== 'OPEN') continue;
    const post = r.targetType === 'POST' ? db.posts.get(r.targetId) : postOfComment(r.targetId);
    if (!post || seen.has(post.id)) continue;
    seen.add(post.id);
    const open = openReportsFor(post.id);
    items.push({ id: post.id, source: 'REPORTS', mediaId: null, postId: post.id, openReports: open.length, enqueuedAt: open.map((x) => x.createdAt).sort()[0] });
  }
  return items;
}
export function emitQueue(type, item) {
  if (!item) return;
  bus.emit('moderationQueue', { type, item, totalCount: queueItems().length });
}

/** Cambia el estado de un medio y propaga a los posts que lo contienen (misma regla que media-service + social-service). */
export function setMediaStatus(m, status, { decision, note, by } = {}) {
  const was = m.status;
  const wasItem = was === 'FLAGGED' ? queueItems().find((i) => i.id === m.id) : null;
  m.status = status;
  m.updatedAt = now();
  if (decision && m.moderation) m.moderation.finalDecision = { decision, note: note ?? null, decidedBy: by, decidedAt: now() };
  for (const p of db.posts.values()) {
    if (!p.mediaIds.includes(m.id)) continue;
    if (status === 'APPROVED' && p.status === 'PENDING_MEDIA' && p.mediaIds.every((id) => db.media.get(id)?.status === 'APPROVED')) Object.assign(p, { status: 'PUBLISHED', updatedAt: now() });
    if (status === 'REJECTED') Object.assign(p, { status: 'HIDDEN', hiddenReason: 'MEDIA_FLAGGED', updatedAt: now() });
  }
  if (wasItem && status !== 'FLAGGED') emitQueue('RESOLVED', wasItem);
  if (status === 'FLAGGED') {
    const item = queueItems().find((i) => i.id === m.id);
    if (item) emitQueue('ADDED', item);
    notify(m.ownerId, 'CONTENT_FLAGGED', {}, '/posts');
  }
}
