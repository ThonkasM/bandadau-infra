#!/usr/bin/env node
// Historial de demo para Reportes y gráficas: inscripciones con la SAGA real (confirmadas, EVENT_FULL, saldo
// insuficiente, cancelación con reembolso). Paso 1 de 2; el paso 2 (saga-history-backdate.mjs) mueve las fechas.
//   SEED_PROFILE=uagrm SEED_API_URL=https://api.bandadau.lat/api/v1 node seed/saga-history.mjs
import { cfg } from './lib/env.mjs';
import { request, poll, problem } from './lib/http.mjs';
import { stableUuid } from './lib/ids.mjs';
import { login } from './lib/identity.mjs';
import { createReport } from './lib/report.mjs';
import { email, HISTORY_EVENTS, HISTORY_TOPUP_USERS, regKey, topupKey } from './lib/history-data.mjs';

const report = createReport('Historial de demo (SAGA y asistencia)');
const { step } = report;
const tokens = {};
const days = (n) => new Date(Date.now() + n * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');

async function token(key) {
  if (tokens[key]) return tokens[key];
  const r = await login(email(key), cfg.password);
  if (!r.ok) throw new Error(`login de ${key}: ${problem(r)}`);
  return (tokens[key] = r.json.accessToken);
}

async function listAllEvents(t) {
  const out = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const r = await request('GET', `${cfg.api}/events?limit=50&from=2000-01-01T00:00:00Z${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { token: t });
    if (!r.ok) throw new Error(`listEvents: ${problem(r)}`);
    out.push(...(r.json.items ?? []));
    cursor = r.json.nextCursor;
    if (!cursor) break;
  }
  return out;
}

const finalState = async (t, id) => poll(async () => {
  const g = await request('GET', `${cfg.api}/registrations/${id}`, { token: t });
  return g.ok && !['PENDING', 'CANCELLATION_PENDING'].includes(g.json.status) ? g.json : null;
}, { timeoutMs: 60000, intervalMs: 1500 });

console.log(`API ${cfg.api}\n`);

// 1) Recargas (el simulador de pagos del wallet debe estar activo)
for (const user of HISTORY_TOPUP_USERS) {
  for (const n of [1, 2]) {
    await step(`Recarga ${n}/2 de ${user}: CREDITS_100`, async () => {
      const t = await token(user);
      const top = await request('POST', `${cfg.api}/wallet/topups`, { token: t, idempotencyKey: stableUuid(topupKey(user, n)), body: { package: 'CREDITS_100' } });
      if (!top.ok) throw new Error(`createTopUp: ${problem(top)}`);
      const pay = await request('POST', `${cfg.api}/wallet/topups/${top.json.topUpId}/simulate-payment`, { token: t, body: { outcome: 'PAID' } });
      if (!pay.ok && pay.status !== 409) throw new Error(`simulate-payment: ${problem(pay)}`);
      return `recarga ${top.json.topUpId}`;
    });
  }
}
await new Promise((r) => setTimeout(r, 4000)); // el saldo llega por mensajería

// 2) Eventos + inscripciones, del más antiguo al más reciente
const eventIds = {};
for (const e of HISTORY_EVENTS) {
  await step(`Evento "${e.title}" (${e.priceCredits} cr., cupo ${e.capacity})`, async () => {
    const t = await token(e.by);
    const existing = (await listAllEvents(t)).find((x) => x.title === e.title);
    let id = existing?.id;
    if (!id) {
      const c = await request('POST', `${cfg.api}/events`, {
        token: t, idempotencyKey: stableUuid(`seed:history:event:${e.key}`),
        // Siempre a futuro (la API rechaza fechas pasadas); saga-history-backdate.mjs lo mueve si es un evento realizado.
        body: { title: e.title, description: e.description, startsAt: days(e.daysAhead ?? 2), venue: e.venue, capacity: e.capacity, priceCredits: e.priceCredits },
      });
      if (!c.ok) throw new Error(`createEvent: ${problem(c)}`);
      id = c.json.id;
    }
    if (!existing || existing.status !== 'PUBLISHED') {
      const p = await request('POST', `${cfg.api}/events/${id}/publish`, { token: t });
      if (!p.ok && p.status !== 409) throw new Error(`publishEvent: ${problem(p)}`);
    }
    eventIds[e.key] = id;
    return id;
  });

  for (const user of e.regs) {
    await step(`  Inscripción de ${user} → ${e.key}`, async () => {
      const t = await token(user);
      const r = await request('POST', `${cfg.api}/events/${eventIds[e.key]}/registrations`, { token: t, idempotencyKey: stableUuid(regKey(user, e.key)) });
      if (r.status === 409) return 'ya inscrito';
      if (!r.ok) throw new Error(`register: ${problem(r)}`);
      const id = r.json.id ?? r.json.registrationId;
      const final = await finalState(t, id);
      if (!final) throw new Error(`la inscripción ${id} sigue PENDING`);
      // FAILED es un resultado esperado (EVENT_FULL / saldo insuficiente): demuestra la compensación de la SAGA.
      if (e.cancels?.includes(user) && final.status === 'CONFIRMED') {
        const c = await request('POST', `${cfg.api}/registrations/${id}/cancel`, { token: t, idempotencyKey: stableUuid(`seed:history:cancel:${user}:${e.key}`) });
        if (!c.ok && c.status !== 409) throw new Error(`cancelRegistration: ${problem(c)}`);
        const done = await finalState(t, id);
        return `CONFIRMED → ${done?.status ?? 'sin resolver'}`;
      }
      return `${final.status}${final.failureReason ? ` (${final.failureReason})` : ''}`;
    });
  }
}

process.exit(report.finish());
