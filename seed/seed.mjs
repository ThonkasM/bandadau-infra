#!/usr/bin/env node
// Datos de demo de la fase 1 (contrato §3.5) usando solo APIs públicas e internas. Idempotente: re-ejecutable.
//   make seed   |   node seed/seed.mjs
import { cfg } from './lib/env.mjs';
import { request, waitForUrl, problem } from './lib/http.mjs';
import { stableUuid } from './lib/ids.mjs';
import { createReport } from './lib/report.mjs';
import { mailpitAvailable } from './lib/mailpit.mjs';
import { ensureUniversity, ensureUser, ensureRoles, login } from './lib/identity.mjs';
import { UNIVERSITIES, USERS, GROUP, POSTS, EVENTS, DEFAULT_UNIVERSITY } from './lib/demo-data.mjs';
import { seedExtra } from './extra.mjs';

const report = createReport('Seed Bandada U (fase 1)');
const { step } = report;
const ctx = { universities: {}, users: {}, tokens: {} };

console.log(`API ${cfg.api}\nidentity (interno) ${cfg.identityInternal}\nMailpit ${cfg.mailpit}\n`);

const apiUp = await step('API disponible (Traefik → identity)', async () => {
  if (!(await waitForUrl(`${cfg.api}/universities`, { timeoutMs: 120000, ok: (s) => s === 200 }))) {
    throw new Error(`${cfg.api}/universities no responde 200 (¿make up terminó? ¿resuelve *.localhost?)`);
  }
  return 'GET /universities 200';
}).then(() => report.rows.at(-1).status === 'ok');

if (!apiUp) process.exit(report.finish());

await step('Mailpit disponible (verificación de email)', async () => {
  if (!(await mailpitAvailable())) throw new Error(`${cfg.mailpit} no responde`);
});

for (const u of UNIVERSITIES) {
  await step(`Universidad ${u.code} (${u.domain})`, async () => {
    const { university, created } = await ensureUniversity(u);
    ctx.universities[u.code] = university;
    return `${created ? 'creada' : 'ya existía'} ${university.id}`;
  });
}

for (const u of USERS) {
  await step(`Usuario ${u.email}`, async () => {
    const code = u.university ?? DEFAULT_UNIVERSITY;
    const uni = ctx.universities[code];
    if (!uni) throw new Error(`falta la universidad ${code}`);
    let { tokens, user, created } = await ensureUser({ email: u.email, password: cfg.password, universityId: uni.id });
    const changed = await ensureRoles(user, u.roles);
    if (changed) { // el JWT lleva los roles: se vuelve a iniciar sesión para obtener los nuevos
      const r = await login(u.email, cfg.password);
      if (!r.ok) throw new Error(`login tras cambiar roles: ${problem(r)}`);
      ({ tokens, user } = { tokens: r.json, user: r.json.user });
    }
    ctx.users[u.key] = user;
    ctx.tokens[u.key] = tokens.accessToken;
    return `${created ? 'verificado' : 'ya existía'} · roles ${[...user.roles].join('+')}${changed ? ' (actualizados)' : ''}`;
  });
}

await step('Wallet de Lucía: +100 créditos (simulate-payment)', async () => {
  const t = ctx.tokens.lucia;
  if (!t) throw new Error('sin sesión de Lucía');
  // Idempotente: si el libro mayor ya tiene una recarga, no se vuelve a recargar.
  const entries = await request('GET', `${cfg.api}/wallet/me/entries?limit=50`, { token: t });
  if (entries.ok && (entries.json.items ?? []).some((e) => String(e.operationRef).startsWith('TOPUP:'))) {
    const w = await request('GET', `${cfg.api}/wallet/me`, { token: t });
    return `ya recargada (saldo ${w.json?.balanceCredits})`;
  }
  const top = await request('POST', `${cfg.api}/wallet/topups`, {
    token: t, idempotencyKey: stableUuid('seed:topup:lucia:100'), body: { package: 'CREDITS_100' },
  });
  if (!top.ok) throw new Error(`createTopUp: ${problem(top)}`);
  const pay = await request('POST', `${cfg.api}/wallet/topups/${top.json.topUpId}/simulate-payment`, { token: t, body: { outcome: 'PAID' } });
  if (!pay.ok && pay.status !== 409) throw new Error(`simulate-payment: ${problem(pay)}`);
  let balance;
  for (let i = 0; i < 15; i++) {
    const w = await request('GET', `${cfg.api}/wallet/me`, { token: t });
    balance = w.json?.balanceCredits;
    if (balance >= 100) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!(balance >= 100)) throw new Error(`saldo esperado ≥ 100, actual ${balance}`);
  return `saldo ${balance}`;
});

let groupId;
await step(`Grupo "${GROUP.name}"`, async () => {
  const t = ctx.tokens.lucia;
  if (!t) throw new Error('sin sesión de Lucía');
  const found = await request('GET', `${cfg.api}/groups?query=${encodeURIComponent(GROUP.name)}`, { token: t });
  const existing = (found.json?.items ?? []).find((g) => g.name === GROUP.name);
  if (existing) { groupId = existing.id; return `ya existía ${groupId}`; }
  const r = await request('POST', `${cfg.api}/groups`, { token: t, idempotencyKey: stableUuid('seed:group:iso2'), body: GROUP });
  if (!r.ok) throw new Error(`createGroup: ${problem(r)}`);
  groupId = r.json.id;
  return `creado ${groupId}`;
});

await step('Marco se une al grupo', async () => {
  const t = ctx.tokens.marco;
  if (!t || !groupId) throw new Error('falta sesión de Marco o el grupo');
  const r = await request('POST', `${cfg.api}/groups/${groupId}/join`, { token: t });
  if (!r.ok && r.status !== 409) throw new Error(`joinGroup: ${problem(r)}`);
  return r.status === 409 ? 'ya era miembro' : `membresía ${r.json?.status ?? 'ok'}`;
});

for (const p of POSTS) {
  await step(`Post de ${p.author}: "${p.text.slice(0, 32)}…"`, async () => {
    const t = ctx.tokens[p.author];
    if (!t) throw new Error(`sin sesión de ${p.author}`);
    if (p.visibility === 'GROUP' && !groupId) throw new Error('el grupo no existe');
    const body = { clientId: stableUuid(`seed:post:${p.slug}`), text: p.text, mediaIds: [], visibility: p.visibility, ...(p.visibility === 'GROUP' ? { groupId } : {}) };
    const r = await request('POST', `${cfg.api}/posts`, { token: t, idempotencyKey: stableUuid(`seed:post-key:${p.slug}`), body });
    if (!r.ok) throw new Error(`createPost: ${problem(r)}`);
    return r.status === 200 ? 'ya existía (clientId)' : `creado ${r.json.id}`;
  });
}

async function listAllEvents(token) {
  const out = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const r = await request('GET', `${cfg.api}/events?limit=50&from=2000-01-01T00:00:00Z${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { token });
    if (!r.ok) throw new Error(`listEvents: ${problem(r)}`);
    out.push(...(r.json.items ?? []));
    cursor = r.json.nextCursor;
    if (!cursor) break;
  }
  return out;
}

for (const e of EVENTS) {
  await step(`Evento "${e.title}" (${e.priceCredits} cr., cupo ${e.capacity})`, async () => {
    const t = ctx.tokens.org;
    if (!t) throw new Error('sin sesión del organizador');
    const existing = (await listAllEvents(t)).find((x) => x.title === e.title);
    if (existing && existing.status === 'PUBLISHED') return `ya publicado ${existing.id}`;
    let id = existing?.id;
    if (!id) {
      const c = await request('POST', `${cfg.api}/events`, {
        token: t,
        idempotencyKey: stableUuid(`seed:event:${e.title}`),
        body: { title: e.title, description: e.description, startsAt: e.startsAt(), venue: e.venue, capacity: e.capacity, priceCredits: e.priceCredits },
      });
      if (!c.ok) throw new Error(`createEvent: ${problem(c)}`);
      id = c.json.id;
    }
    const p = await request('POST', `${cfg.api}/events/${id}/publish`, { token: t });
    if (!p.ok) throw new Error(`publishEvent: ${problem(p)}`);
    return `publicado ${id}`;
  });
}

if (!process.argv.includes('--basic')) await seedExtra({ step, ctx, groupId });

console.log('\nCredenciales de demo (solo dev):');
for (const u of USERS) console.log(`  ${u.email.padEnd(20)} ${cfg.password}   [${u.roles.join('+')}]`);
process.exit(report.finish());
