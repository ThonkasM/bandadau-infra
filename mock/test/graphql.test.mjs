import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { buildSchema as sdlSchema, printSchema } from 'graphql';
import { createClient } from 'graphql-ws';
import WebSocket from 'ws';
import { app, login, origin, port, stop } from './helpers.mjs';
import { SDL_PATH } from '../src/spec.mjs';

after(stop);
const gql = async (query, { token, variables, lang } = {}) => {
  const r = await fetch(`${origin}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(lang ? { 'accept-language': lang } : {}) }, body: JSON.stringify({ query, variables }) });
  return r.json();
};

describe('SDL', () => {
  it('el esquema ejecutable conserva exactamente los tipos y campos del SDL del contrato', () => {
    const contract = sdlSchema(readFileSync(SDL_PATH, 'utf8'));
    const served = app.gqlSchema;
    const names = (s) => Object.keys(s.getTypeMap()).filter((n) => !n.startsWith('__')).sort();
    assert.deepEqual(names(served), names(contract));
    for (const root of ['Query', 'Mutation', 'Subscription'])
      assert.deepEqual(Object.keys(served.getType(root).getFields()).sort(), Object.keys(contract.getType(root).getFields()).sort());
    assert.ok(printSchema(served).includes('directive @auth'));
  });
});

describe('@auth y fase 2', () => {
  it('sin token → UNAUTHENTICATED; estudiante → FORBIDDEN; moderador no ve dashboard', async () => {
    assert.equal((await gql('{ me { id } }')).errors[0].extensions.code, 'UNAUTHENTICATED');
    const lu = await login('lucia@umsa.edu.bo');
    assert.equal((await gql('{ me { id } }', { token: lu.token })).errors[0].extensions.code, 'FORBIDDEN');
    const mod = await login('mod@umsa.edu.bo');
    assert.equal((await gql('{ me { email roles } }', { token: mod.token })).data.me.email, 'mod@umsa.edu.bo');
    assert.equal((await gql('{ users { edges { cursor } } }', { token: mod.token })).errors[0].extensions.code, 'FORBIDDEN');
  });
  it('campos de fase 2 → FEATURE_DISABLED', async () => {
    const admin = await login('admin@umsa.edu.bo');
    for (const q of ['{ reports { edges { cursor } } }', '{ alerts { id } }', '{ agentRuns { edges { cursor } } }', 'mutation { runMonitoringNow { errors { code } } }']) {
      const r = await gql(q, { token: admin.token });
      assert.equal(r.errors[0].extensions.code, 'FEATURE_DISABLED', q);
    }
  });
});

describe('consultas de admin', () => {
  it('dashboard, users (Relay), events/registrations/sagas, walletStats, serviceHealth', async () => {
    const { token } = await login('admin@umsa.edu.bo');
    const d = await gql('query($r: DateRangeInput!){ dashboard(range:$r){ activeUsers posts flaggedContent openAlerts series { name points { date value } } } walletStats(range:$r){ topUpCredits netCredits series { date topUpCredits } } }', { token, variables: { r: { from: '2026-10-01', to: '2026-10-14' } } });
    assert.equal(d.errors, undefined);
    assert.equal(d.data.dashboard.series[0].points.length, 14);
    const u = await gql('{ users(first: 3) { edges { cursor node { email roles university { name } } } pageInfo { hasNextPage endCursor } } }', { token });
    assert.equal(u.data.users.edges.length, 3);
    assert.equal(u.data.users.pageInfo.hasNextPage, true);
    const next = await gql('query($a:String){ users(first: 50, after:$a) { edges { node { email } } } }', { token, variables: { a: u.data.users.pageInfo.endCursor } });
    assert.equal(next.data.users.edges.length, 7);
    const s = await gql('{ sagas(status: FAILED) { id status step failureReason registrationId } events { title seatsTaken registrations { status saga { status } } } serviceHealth { overall services { name status } queues { name isDeadLetter } } }', { token });
    assert.equal(s.errors, undefined);
    assert.equal(s.data.sagas.length, 1);
    assert.ok(s.data.events.length >= 4);
    assert.equal(s.data.serviceHealth.services.length, 8);
  });

  it('moderationQueue + moderateMedia / resolveContentReport mutan el estado', async () => {
    const { token } = await login('mod@umsa.edu.bo');
    const q = '{ moderationQueue(first: 20) { totalCount edges { node { id source openReports media { id status kind previewUrl moderation { decision maxScore labels scores } } post { text author { displayName } } } } } }';
    const before = await gql(q, { token });
    assert.equal(before.errors, undefined);
    const items = before.data.moderationQueue.edges.map((e) => e.node);
    const ai = items.find((i) => i.source === 'AI');
    assert.ok(ai.media.moderation.maxScore > 0.5);
    const rep = items.find((i) => i.source === 'REPORTS');
    assert.ok(rep.openReports >= 1);
    const m = await gql('mutation($id:UUID!){ moderateMedia(id:$id, decision: APPROVE, note:"ok"){ media { id status } errors { code message } } }', { token, variables: { id: ai.id } });
    assert.equal(m.data.moderateMedia.media.status, 'APPROVED');
    const again = await gql('mutation($id:UUID!){ moderateMedia(id:$id, decision: APPROVE){ errors { code } } }', { token, variables: { id: ai.id } });
    assert.equal(again.data.moderateMedia.errors[0].code, 'MEDIA_NOT_FLAGGED');
    const reports = await gql('{ contentReports(status: OPEN) { id targetType reason post { id } } }', { token });
    const r = reports.data.contentReports[0];
    const res = await gql('mutation($i:ResolveContentReportInput!){ resolveContentReport(input:$i){ report { status resolution } errors { code } } }', { token, variables: { i: { reportId: r.id, resolution: 'REMOVE', note: 'incumple normas' } } });
    assert.equal(res.data.resolveContentReport.report.status, 'RESOLVED_REMOVED');
    const after = await gql(q, { token });
    assert.equal(after.data.moderationQueue.totalCount, before.data.moderationQueue.totalCount - 2);
  });

  it('suspendUser / reactivateUser y errores localizados', async () => {
    const mod = await login('mod@umsa.edu.bo');
    const admin = await login('admin@umsa.edu.bo');
    const users = await gql('{ users(filter:{query:"marco"}) { edges { node { id status } } } }', { token: admin.token });
    const id = users.data.users.edges[0].node.id;
    const s = await gql('mutation($i:SuspendUserInput!){ suspendUser(input:$i){ user { status suspensionReason } errors { code } } }', { token: mod.token, variables: { i: { userId: id, reason: 'spam' } } });
    assert.equal(s.data.suspendUser.user.status, 'SUSPENDED');
    const rest = await fetch(`${origin}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'marco@umsa.edu.bo', password: 'Bandada#2026' }) });
    assert.equal((await rest.json()).code, 'ACCOUNT_SUSPENDED');
    const en = await gql('mutation($i:SuspendUserInput!){ suspendUser(input:$i){ errors { code message } } }', { token: mod.token, variables: { i: { userId: id, reason: 'spam' } }, lang: 'en' });
    assert.equal(en.data.suspendUser.errors[0].code, 'INVALID_STATUS_TRANSITION');
    assert.match(en.data.suspendUser.errors[0].message, /state/);
    const re = await gql('mutation($i:ReactivateUserInput!){ reactivateUser(input:$i){ user { status } errors { code } } }', { token: admin.token, variables: { i: { userId: id } } });
    assert.equal(re.data.reactivateUser.user.status, 'ACTIVE');
  });

  it('retrySaga reanuda la SAGA FAILED hasta completarse', async () => {
    const { token } = await login('admin@umsa.edu.bo');
    const f = await gql('{ sagas(status: FAILED) { id registrationId } }', { token });
    const { id } = f.data.sagas[0];
    const r = await gql('mutation($id:UUID!){ retrySaga(id:$id){ saga { status retries } errors { code } } }', { token, variables: { id } });
    assert.equal(r.data.retrySaga.saga.status, 'AWAITING_TICKET');
    await new Promise((x) => setTimeout(x, 1300));
    const after = await gql('{ sagas(type: REGISTRATION, first: 50) { id status } }', { token });
    assert.equal(after.data.sagas.find((s) => s.id === id).status, 'COMPLETED');
    const again = await gql('mutation($id:UUID!){ retrySaga(id:$id){ errors { code } } }', { token, variables: { id } });
    assert.equal(again.data.retrySaga.errors[0].code, 'SAGA_NOT_RETRYABLE');
  });
});

describe('subscription moderationQueueChanged (graphql-transport-ws)', () => {
  const subscribe = (token, query) => {
    const client = createClient({ url: `ws://127.0.0.1:${port}/graphql`, webSocketImpl: WebSocket, connectionParams: token ? { Authorization: `Bearer ${token}` } : {}, retryAttempts: 0 });
    const events = [];
    const dispose = client.subscribe({ query }, { next: (v) => events.push(v), error: (e) => events.push({ error: e }), complete: () => {} });
    return { client, events, stop: () => { dispose(); client.dispose(); } };
  };
  const until = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timeout esperando evento'); };
  const Q = 'subscription { moderationQueueChanged { type totalCount item { id source media { status } openReports } } }';

  it('emite tras una mutación y de forma periódica', async () => {
    const { token } = await login('mod@umsa.edu.bo');
    const s = subscribe(token, Q);
    await new Promise((r) => setTimeout(r, 300));
    const q = await gql('{ moderationQueue(filter:{source: AI}) { edges { node { id } } } }', { token });
    const id = q.data.moderationQueue.edges[0].node.id;
    await gql('mutation($id:UUID!){ moderateMedia(id:$id, decision: REJECT){ errors { code } } }', { token, variables: { id } });
    const ev = await until(() => s.events.find((e) => e.data?.moderationQueueChanged.item.id === id));
    assert.equal(ev.data.moderationQueueChanged.type, 'RESOLVED');
    const tick = await until(() => s.events.find((e) => e.data?.moderationQueueChanged.type === 'ADDED'), 5000);
    assert.ok(tick.data.moderationQueueChanged.totalCount >= 1);
    s.stop();
  });
  it('sin token la suscripción falla con UNAUTHENTICATED', async () => {
    const s = subscribe(null, Q);
    const e = await until(() => s.events[0]);
    assert.ok(JSON.stringify(e).includes('UNAUTHENTICATED'));
    s.stop();
  });
});
