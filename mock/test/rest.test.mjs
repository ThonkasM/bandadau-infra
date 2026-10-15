import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { app, call, login, origin, sleep, stop, UMSA, PASSWORD } from './helpers.mjs';

after(stop);
const idem = () => ({ 'idempotency-key': randomUUID() });
const ok = (r, msg) => assert.deepEqual(r.schemaErrors, [], `${msg ?? ''} esquema: ${JSON.stringify(r.schemaErrors)} body=${JSON.stringify(r.body)?.slice(0, 300)}`);

describe('contrato', () => {
  it('todas las operaciones públicas tienen handler', () => assert.deepEqual(app.missingHandlers, []));
  it('/health/ready y JWKS', async () => {
    assert.equal((await fetch(`${origin}/health/ready`)).status, 200);
    const j = await (await fetch(`${origin}/.well-known/jwks.json`)).json();
    assert.ok(j.keys.length);
    ok(await call('getJwks'));
  });
  it('bloquea /internal y service-token como Traefik', async () => {
    assert.equal((await fetch(`${origin}/internal/v1/users`)).status, 403);
    assert.equal((await fetch(`${origin}/api/v1/auth/service-token`, { method: 'POST' })).status, 403);
  });
  it('insights → FEATURE_DISABLED', async () => {
    const r = await fetch(`${origin}/api/v1/insights/anything`);
    assert.equal(r.status, 503);
    assert.equal((await r.json()).code, 'FEATURE_DISABLED');
  });
});

describe('errores Problem Details', () => {
  it('401 sin token, es/en, Content-Language', async () => {
    const es = await call('getMe');
    assert.equal(es.status, 401); ok(es);
    assert.equal(es.body.code, 'UNAUTHORIZED');
    assert.match(es.headers.get('content-type'), /application\/problem\+json/);
    assert.equal(es.headers.get('content-language'), 'es');
    const en = await call('getMe', { headers: { 'accept-language': 'en-US,en;q=0.9' } });
    assert.equal(en.body.title, 'Not authenticated');
    assert.equal(en.headers.get('content-language'), 'en');
  });
  it('400 validación con errors[]', async () => {
    const r = await call('login', { body: { email: 'no-es-correo', password: 'x' } });
    assert.equal(r.status, 400); ok(r);
    assert.equal(r.body.code, 'VALIDATION_FAILED');
    assert.ok(r.body.errors.some((e) => e.field === 'email'));
  });
  it('400 sin Idempotency-Key en un ♻️', async () => {
    const { token } = await login('lucia@umsa.edu.bo');
    const r = await call('createGroup', { token, body: { name: 'X', subject: 'Y', privacy: 'PUBLIC' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.errors[0].field, 'Idempotency-Key');
  });
  it('403 por rol', async () => {
    const { token } = await login('lucia@umsa.edu.bo');
    const r = await call('createEvent', { token, headers: idem(), body: { title: 'Evento de prueba', description: 'Descripción de prueba', startsAt: new Date(Date.now() + 864e5).toISOString(), venue: 'Aula 1', capacity: 5, priceCredits: 0 } });
    assert.equal(r.status, 403); ok(r);
    assert.equal(r.body.code, 'FORBIDDEN');
  });
  it('credenciales inválidas 401', async () => {
    const r = await call('login', { body: { email: 'lucia@umsa.edu.bo', password: 'Incorrecta#1' } });
    assert.equal(r.status, 401); assert.equal(r.body.code, 'INVALID_CREDENTIALS');
  });
});

describe('identidad: registro → verificación → login → refresh → handoff', () => {
  it('flujo completo con cookie (web) y cuerpo (native)', async () => {
    const email = `test.${Date.now()}@umsa.edu.bo`;
    const key = idem();
    const reg = await call('registerUser', { headers: key, body: { email, password: PASSWORD, universityId: UMSA }, expect: 201 }); ok(reg);
    const rep = await call('registerUser', { headers: key, body: { email, password: PASSWORD, universityId: UMSA }, expect: 201 });
    assert.equal(rep.headers.get('idempotent-replayed'), 'true');
    const reused = await call('registerUser', { headers: key, body: { email: 'otro@umsa.edu.bo', password: PASSWORD, universityId: UMSA } });
    assert.equal(reused.body.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal((await call('login', { body: { email, password: PASSWORD } })).body.code, 'EMAIL_NOT_VERIFIED');
    assert.equal((await call('verifyEmail', { body: { email, code: '000000' } })).body.code, 'INVALID_VERIFICATION_CODE');
    const ver = await call('verifyEmail', { body: { email, code: '123456' }, headers: { 'x-bandada-client': 'web' }, expect: 200 }); ok(ver);
    const cookie = ver.headers.get('set-cookie');
    assert.match(cookie, /refresh_token=.+; Path=\/api\/v1\/auth; HttpOnly; SameSite=Strict/);
    assert.equal(ver.body.refreshToken, '');
    // refresh con cookie
    const refreshed = await call('refreshToken', { headers: { 'x-bandada-client': 'web', cookie: cookie.split(';')[0] }, expect: 200 }); ok(refreshed);
    // reutilizar el mismo token → REFRESH_TOKEN_REUSED
    const reuse = await call('refreshToken', { headers: { 'x-bandada-client': 'web', cookie: cookie.split(';')[0] } });
    assert.equal(reuse.body.code, 'REFRESH_TOKEN_REUSED');
    // native: refresh en el cuerpo
    const nat = await call('login', { body: { email, password: PASSWORD }, expect: 200 }); ok(nat);
    assert.ok(nat.body.refreshToken.length > 20);
    assert.equal(nat.headers.get('set-cookie'), null);
    const r2 = await call('refreshToken', { body: { refreshToken: nat.body.refreshToken }, expect: 200 });
    assert.notEqual(r2.body.refreshToken, nat.body.refreshToken);
    const me = await call('getMe', { token: r2.body.accessToken, expect: 200 }); ok(me);
    assert.deepEqual(me.body.roles, ['STUDENT']);
  });

  it('handoff PKCE funcional y de un solo uso', async () => {
    const { token } = await login('mod@umsa.edu.bo');
    const verifier = 'a'.repeat(50);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const h = await call('createHandoffCode', { token, body: { targetApp: 'ADMIN', codeChallenge: challenge, codeChallengeMethod: 'S256' }, expect: 201 }); ok(h);
    assert.match(h.body.redirectUrl, /sso\/callback\?code=/);
    const bad = await call('exchangeHandoffCode', { body: { code: h.body.code, codeVerifier: 'b'.repeat(50) } });
    assert.equal(bad.body.code, 'HANDOFF_CODE_INVALID');
    const h2 = await call('createHandoffCode', { token, body: { targetApp: 'ADMIN', codeChallenge: challenge, codeChallengeMethod: 'S256' }, expect: 201 });
    const ex = await call('exchangeHandoffCode', { body: { code: h2.body.code, codeVerifier: verifier }, headers: { 'x-bandada-client': 'admin' }, expect: 200 }); ok(ex);
    assert.equal((await call('exchangeHandoffCode', { body: { code: h2.body.code, codeVerifier: verifier } })).status, 401);
    // un estudiante no puede abrir el panel
    const lu = await login('lucia@umsa.edu.bo');
    assert.equal((await call('createHandoffCode', { token: lu.token, body: { targetApp: 'ADMIN', codeChallenge: challenge, codeChallengeMethod: 'S256' } })).status, 403);
  });
});

describe('social: feed, posts, comentarios, reacciones, follows, grupos', () => {
  it('feed paginado por cursor sin repetir elementos', async () => {
    const { token } = await login('lucia@umsa.edu.bo');
    const seen = new Set();
    let cursor, pages = 0;
    do {
      const r = await call('getFeed', { token, query: { limit: 10, ...(cursor ? { cursor } : {}) }, expect: 200 }); ok(r);
      for (const i of r.body.items) { assert.ok(!seen.has(i.post.id)); seen.add(i.post.id); }
      cursor = r.body.nextCursor; pages++;
    } while (cursor && pages < 10);
    assert.ok(seen.size >= 30, `feed con ${seen.size} posts`);
  });
  it('crear post (idempotente), comentar, reaccionar, seguir', async () => {
    const { token, user } = await login('lucia@umsa.edu.bo');
    const body = { clientId: randomUUID(), text: 'Probando el mock #bandada', mediaIds: [], visibility: 'PUBLIC' };
    const key = idem();
    const p = await call('createPost', { token, headers: key, body, expect: 201 }); ok(p);
    assert.deepEqual(p.body.hashtags, ['bandada']);
    const again = await call('createPost', { token, headers: key, body, expect: 201 });
    assert.equal(again.headers.get('idempotent-replayed'), 'true');
    const dup = await call('createPost', { token, headers: idem(), body, expect: 200 }); // mismo clientId → 200
    assert.equal(dup.body.id, p.body.id);
    const feed = await call('getFeed', { token, query: { limit: 1 } });
    assert.equal(feed.body.items[0].post.id, p.body.id);
    const marco = await login('marco@umsa.edu.bo');
    const c = await call('createComment', { token: marco.token, headers: idem(), params: { postId: p.body.id }, body: { text: '¡Buenísimo!' }, expect: 201 }); ok(c);
    const lc = await call('listComments', { token, params: { postId: p.body.id }, expect: 200 }); ok(lc);
    assert.equal(lc.body.items.length, 1);
    const rx = await call('setReaction', { token: marco.token, params: { postId: p.body.id }, body: { type: 'HELPFUL' }, expect: 200 }); ok(rx);
    assert.equal(rx.body.reactionCounts.helpful, 1);
    const sug = await call('getFollowSuggestions', { token, expect: 200 }); ok(sug);
    const f = await call('followUser', { token, params: { userId: sug.body.items[0].profile.userId }, expect: 200 }); ok(f);
    assert.equal((await call('followUser', { token, params: { userId: user.id } })).body.code, 'CANNOT_FOLLOW_SELF');
    const n = await call('listNotifications', { token: marco.token, expect: 200 }); ok(n);
    assert.ok(Number(n.headers.get('x-unread-count')) >= 1);
    const pr = await call('getProfile', { token, params: { userId: marco.user.id }, expect: 200 }); ok(pr);
  });
  it('grupos: público activo / privado pendiente → aprobar', async () => {
    const lucia = await login('lucia@umsa.edu.bo');
    const diego = await login('diego@ucb.edu.bo');
    const groups = await call('listGroups', { token: lucia.token, expect: 200 }); ok(groups);
    const priv = groups.body.items.find((g) => g.privacy === 'PRIVATE');
    const j = await call('joinGroup', { token: lucia.token, params: { groupId: priv.id }, expect: 200 }); ok(j);
    assert.equal(j.body.status, 'PENDING');
    const ap = await call('approveGroupMember', { token: diego.token, params: { groupId: priv.id, userId: lucia.user.id }, expect: 200 }); ok(ap);
    assert.equal(ap.body.status, 'ACTIVE');
    assert.equal((await call('approveGroupMember', { token: diego.token, params: { groupId: priv.id, userId: lucia.user.id } })).body.code, 'MEMBERSHIP_NOT_PENDING');
  });
  it('denuncias: no propias, no duplicadas', async () => {
    const marco = await login('marco@umsa.edu.bo');
    const feed = await call('getFeed', { token: marco.token, query: { limit: 50 } });
    const other = feed.body.items.find((i) => i.post.authorId !== marco.user.id && i.post.visibility === 'PUBLIC').post;
    const r = await call('reportContent', { token: marco.token, headers: idem(), body: { targetType: 'POST', targetId: other.id, reason: 'SPAM' }, expect: 201 }); ok(r);
    assert.equal((await call('reportContent', { token: marco.token, headers: idem(), body: { targetType: 'POST', targetId: other.id, reason: 'SPAM' } })).body.code, 'ALREADY_REPORTED');
    const own = feed.body.items.find((i) => i.post.authorId === marco.user.id)?.post;
    if (own) assert.equal((await call('reportContent', { token: marco.token, headers: idem(), body: { targetType: 'POST', targetId: own.id, reason: 'SPAM' } })).body.code, 'CANNOT_REPORT_OWN_CONTENT');
  });
});

describe('media: subida con URL prefirmada → APPROVED → post publicado', () => {
  it('createUpload → PUT → complete → polling → post', async () => {
    const { token } = await login('marco@umsa.edu.bo');
    const up = await call('createUpload', { token, headers: idem(), body: { kind: 'IMAGE', mimeType: 'image/png', sizeBytes: 12, fileName: 'foto.png' }, expect: 201 }); ok(up);
    assert.equal((await call('completeUpload', { token, params: { mediaId: up.body.mediaId } })).body.code, 'UPLOAD_MISSING');
    const put = await fetch(new URL(new URL(up.body.uploadUrl).pathname, origin), { method: 'PUT', headers: { 'content-type': 'image/png' }, body: Buffer.from('fake-png-bytes') });
    assert.equal(put.status, 200);
    const c = await call('completeUpload', { token, params: { mediaId: up.body.mediaId }, expect: 202 }); ok(c);
    assert.equal(c.body.status, 'PROCESSING');
    const post = await call('createPost', { token, headers: idem(), body: { clientId: randomUUID(), text: 'Con foto', mediaIds: [up.body.mediaId], visibility: 'PUBLIC' }, expect: 201 });
    assert.equal(post.body.status, 'PENDING_MEDIA');
    await sleep(1100);
    const m = await call('getMedia', { token, params: { mediaId: up.body.mediaId }, expect: 200 }); ok(m);
    assert.equal(m.body.status, 'APPROVED');
    const p2 = await call('getPost', { token, params: { postId: post.body.id }, expect: 200 }); ok(p2);
    assert.equal(p2.body.status, 'PUBLISHED');
    assert.ok(p2.body.media[0].url);
    const img = await fetch(p2.body.media[0].url.replace(/^http:\/\/localhost:\d+/, origin));
    assert.equal(img.status, 200);
  });
});

describe('eventos, inscripción (SAGA), wallet y tickets', () => {
  const events = async (token) => (await call('listEvents', { token, query: { public: 'true' }, expect: 200 })).body.items;
  const waitRegistration = async (token, id, target) => {
    for (let i = 0; i < 20; i++) {
      const r = await call('getRegistration', { token, params: { registrationId: id }, expect: 200 });
      if (r.body.status === target) return r;
      if (r.body.status === 'PENDING') assert.equal(r.headers.get('retry-after'), '1');
      await sleep(250);
    }
    throw new Error('la inscripción no llegó a ' + target);
  };

  it('3+ eventos publicados y esquema válido', async () => {
    const l = await call('listEvents', { expect: 200 }); ok(l);
    assert.ok(l.body.items.filter((e) => e.status === 'PUBLISHED').length >= 3);
  });

  it('inscripción gratuita: 202 PENDING → CONFIRMED (≈1.5 s) + ticket + QR validable una vez', async () => {
    const lucia = await login('andres@umsa.edu.bo');
    const free = (await events(lucia.token)).find((e) => e.priceCredits === 0 && e.capacity > 1 && !/CHAOS/i.test(e.title));
    const key = idem();
    const t0 = Date.now();
    const reg = await call('registerToEvent', { token: lucia.token, headers: key, params: { eventId: free.id }, expect: 202 }); ok(reg);
    if (reg.body.status !== 'PENDING') throw new Error('debe nacer PENDING');
    assert.match(reg.headers.get('location'), /\/registrations\//);
    const dup = await call('registerToEvent', { token: lucia.token, headers: key, params: { eventId: free.id }, expect: 202 });
    assert.equal(dup.headers.get('idempotent-replayed'), 'true');
    assert.equal(dup.body.id, reg.body.id);
    const done = await waitRegistration(lucia.token, reg.body.id, 'CONFIRMED');
    assert.ok(Date.now() - t0 >= 1300, 'la confirmación debe tardar ~1.5 s');
    ok(done);
    assert.ok(done.body.ticketId);
    const mine = await call('listMyTickets', { token: lucia.token, expect: 200 }); ok(mine);
    const t = await call('getTicket', { token: lucia.token, params: { ticketId: done.body.ticketId }, expect: 200 }); ok(t);
    assert.equal((await call('registerToEvent', { token: lucia.token, headers: idem(), params: { eventId: free.id } })).body.code, 'ALREADY_REGISTERED');
    const org = await login('org@umsa.edu.bo');
    const v = await call('validateTicket', { token: org.token, headers: idem(), body: { qrPayload: t.body.qrPayload, eventId: free.id }, expect: 200 }); ok(v);
    assert.equal(v.body.ticket.status, 'USED');
    const again = await call('validateTicket', { token: org.token, headers: idem(), body: { qrPayload: t.body.qrPayload } });
    assert.equal(again.status, 409); ok(again);
    assert.equal(again.body.code, 'TICKET_ALREADY_USED');
    assert.equal((await call('validateTicket', { token: lucia.token, headers: idem(), body: { qrPayload: t.body.qrPayload } })).status, 403);
    assert.equal((await call('validateTicket', { token: org.token, headers: idem(), body: { qrPayload: t.body.qrPayload.slice(0, -3) + 'AAA' } })).body.code, 'INVALID_QR_SIGNATURE');
    const keys = await call('getTicketSigningKeys', { token: lucia.token, expect: 200 }); ok(keys);
  });

  it('evento de pago: débito de 20 créditos en el libro', async () => {
    const marco = await login('marco@umsa.edu.bo');
    const paid = (await events(marco.token)).find((e) => e.priceCredits === 20 && !/CHAOS/i.test(e.title));
    // marco ya tiene una inscripción atascada (SAGA FAILED) en el taller → usar otro usuario con saldo
    const lucia = await login('lucia@umsa.edu.bo');
    const before = (await call('getMyWallet', { token: lucia.token, expect: 200 })).body.balanceCredits;
    assert.equal(before, 100);
    const reg = await call('registerToEvent', { token: lucia.token, headers: idem(), params: { eventId: paid.id }, expect: 202 });
    await waitRegistration(lucia.token, reg.body.id, 'CONFIRMED');
    const w = await call('getMyWallet', { token: lucia.token, expect: 200 }); ok(w);
    assert.equal(w.body.balanceCredits, 80);
    const led = await call('listMyLedgerEntries', { token: lucia.token, query: { type: 'DEBIT' }, expect: 200 }); ok(led);
    assert.equal(led.body.items[0].amountCredits, 20);
    // cancelar → reembolso
    const c = await call('cancelRegistration', { token: lucia.token, headers: idem(), params: { registrationId: reg.body.id }, expect: 202 }); ok(c);
    await waitRegistration(lucia.token, reg.body.id, 'CANCELLED');
    assert.equal((await call('getMyWallet', { token: lucia.token })).body.balanceCredits, 100);
  });

  it('cupo 1 → EVENT_FULL para el segundo', async () => {
    const lucia = await login('lucia@umsa.edu.bo');
    const marco = await login('marco@umsa.edu.bo');
    const one = (await events(lucia.token)).find((e) => e.capacity === 1);
    const a = await call('registerToEvent', { token: lucia.token, headers: idem(), params: { eventId: one.id }, expect: 202 });
    const b = await call('registerToEvent', { token: marco.token, headers: idem(), params: { eventId: one.id } });
    assert.equal(b.status, 409); ok(b);
    assert.equal(b.body.code, 'EVENT_FULL');
    await waitRegistration(lucia.token, a.body.id, 'CONFIRMED');
  });

  it('CHAOS → FAILED con compensación (reembolso)', async () => {
    const valeria = await login('camila@umsa.edu.bo');
    await call('createTopUp', { token: valeria.token, headers: idem(), body: { package: 'CREDITS_20' }, expect: 201 }).then((t) => call('simulateTopUpPayment', { token: valeria.token, params: { topUpId: t.body.topUpId }, expect: 200 }));
    const bal = (await call('getMyWallet', { token: valeria.token })).body.balanceCredits;
    const chaos = (await events(valeria.token)).find((e) => /CHAOS/i.test(e.title));
    const reg = await call('registerToEvent', { token: valeria.token, headers: idem(), params: { eventId: chaos.id }, expect: 202 });
    const done = await waitRegistration(valeria.token, reg.body.id, 'FAILED'); ok(done);
    assert.equal(done.body.failureReason, 'TICKET_ISSUE_FAILED');
    assert.equal((await call('getMyWallet', { token: valeria.token })).body.balanceCredits, bal);
    const types = (await call('listMyLedgerEntries', { token: valeria.token, query: { limit: 3 } })).body.items.map((e) => e.type);
    assert.deepEqual(types.slice(0, 2).sort(), ['DEBIT', 'REFUND']);
  });

  it('recarga: idempotente por Idempotency-Key y simulate-payment repetible', async () => {
    const { token } = await login('marco@umsa.edu.bo');
    const key = idem();
    const before = (await call('getMyWallet', { token })).body.balanceCredits;
    const t = await call('createTopUp', { token, headers: key, body: { package: 'CREDITS_50' }, expect: 201 }); ok(t);
    const t2 = await call('createTopUp', { token, headers: key, body: { package: 'CREDITS_50' }, expect: 201 });
    assert.equal(t2.headers.get('idempotent-replayed'), 'true');
    assert.equal(t2.body.topUpId, t.body.topUpId);
    assert.equal((await call('createTopUp', { token, headers: key, body: { package: 'CREDITS_100' } })).body.code, 'IDEMPOTENCY_KEY_REUSED');
    const sk = idem();
    const p = await call('simulateTopUpPayment', { token, headers: sk, params: { topUpId: t.body.topUpId }, body: { outcome: 'PAID' }, expect: 200 }); ok(p);
    await call('simulateTopUpPayment', { token, headers: sk, params: { topUpId: t.body.topUpId }, body: { outcome: 'PAID' }, expect: 200 });
    await call('simulateTopUpPayment', { token, params: { topUpId: t.body.topUpId }, body: { outcome: 'PAID' }, expect: 200 });
    const g = await call('getTopUp', { token, params: { topUpId: t.body.topUpId }, expect: 200 }); ok(g);
    assert.equal(g.body.status, 'PAID');
    assert.equal((await call('getMyWallet', { token })).body.balanceCredits, before + 50);
  });

  it('notificaciones y preferencias', async () => {
    const { token } = await login('lucia@umsa.edu.bo');
    const n = await call('listNotifications', { token, expect: 200 }); ok(n);
    const first = n.body.items.find((x) => !x.readAt);
    const r = await call('markNotificationRead', { token, params: { notificationId: first.id }, expect: 200 }); ok(r);
    const all = await call('markAllNotificationsRead', { token, expect: 200 }); ok(all);
    assert.equal((await call('listNotifications', { token, expect: 200 })).headers.get('x-unread-count'), '0');
    const p = await call('updateNotificationPreferences', { token, body: { channels: { push: false, email: true, inApp: true }, mutedTypes: ['NEW_REACTION'] }, expect: 200 }); ok(p);
    const pref = await call('updateMyPreferences', { token, body: { locale: 'en', theme: 'DARK' }, expect: 200 }); ok(pref);
    assert.equal(pref.body.theme, 'DARK');
    const d = await call('registerDevice', { token, params: { token: 'ExponentPushToken[abc]' }, body: { platform: 'ANDROID' }, expect: 200 }); ok(d);
    await call('unregisterDevice', { token, params: { token: 'ExponentPushToken[abc]' }, expect: 204 });
  });

  it('CORS con credenciales para los orígenes de desarrollo', async () => {
    const r = await fetch(`${origin}/api/v1/auth/login`, { method: 'OPTIONS', headers: { origin: 'http://localhost:3001', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-bandada-client' } });
    assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:3001');
    assert.equal(r.headers.get('access-control-allow-credentials'), 'true');
    const bad = await fetch(`${origin}/api/v1/universities`, { headers: { origin: 'http://evil.example' } });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
  });
});
