#!/usr/bin/env node
// 5 eventos de pago próximos (con portada) para mostrar en la demo que se pueden adquirir tickets. Sin movimiento.
//   SEED_PROFILE=uagrm SEED_API_URL=https://api.bandadau.lat/api/v1 node seed/demo-paid-events.mjs
import { cfg } from './lib/env.mjs';
import { request, poll, problem } from './lib/http.mjs';
import { stableUuid } from './lib/ids.mjs';
import { login } from './lib/identity.mjs';
import { demoPng } from './lib/png.mjs';
import { createReport } from './lib/report.mjs';
import { email } from './lib/history-data.mjs';

const report = createReport('Eventos de pago para la demo');
const days = (n) => new Date(Date.now() + n * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const EVENTS = [
  { key: 'python', title: 'Bootcamp de Python para principiantes', description: 'Tu primer programa en una tarde: variables, funciones y un mini proyecto guiado. Trae tu laptop.', venue: 'Laboratorio 1', capacity: 40, priceCredits: 30, by: 'org', ahead: 4, cover: ['#1d4ed8', '#38bdf8'] },
  { key: 'figma', title: 'Workshop de UX/UI con Figma', description: 'Diseña y prototipa una app real: componentes, auto layout y pruebas de usabilidad.', venue: 'Laboratorio 5', capacity: 30, priceCredits: 35, by: 'org2', ahead: 6, cover: ['#7c3aed', '#f472b6'] },
  { key: 'pitch', title: 'Noche de Pitch Startup', description: 'Presenta tu idea en 3 minutos ante un jurado de emprendedores. Cupos para asistentes y expositores.', venue: 'Auditorio Principal', capacity: 60, priceCredits: 25, by: 'org2', ahead: 8, cover: ['#ea580c', '#fbbf24'] },
  { key: 'ctf', title: 'Curso exprés de ciberseguridad y CTF', description: 'Retos de captura la bandera, buenas prácticas y análisis de vulnerabilidades en equipos de 3.', venue: 'Sala Magna', capacity: 25, priceCredits: 40, by: 'org', ahead: 10, cover: ['#047857', '#34d399'] },
  { key: 'fest', title: 'Bandada Fest: noche de música universitaria', description: 'Bandas de estudiantes en vivo, comida y sorteos. Tu ticket QR es tu entrada.', venue: 'Patio Central', capacity: 200, priceCredits: 20, by: 'org2', ahead: 14, cover: ['#be123c', '#fb7185'] },
];
const tokens = {};
const token = async (key) => tokens[key] ??= (async () => { const r = await login(email(key), cfg.password); if (!r.ok) throw new Error(`login ${key}: ${problem(r)}`); return r.json.accessToken; })();

async function uploadCover(t, seed, colors) {
  const bytes = demoPng({ w: 960, h: 540, from: colors[0], to: colors[1], seed });
  const up = await request('POST', `${cfg.api}/media/uploads`, { token: t, idempotencyKey: stableUuid(`seed:paid:media:${seed}`), body: { kind: 'IMAGE', purpose: 'EVENT_COVER', mimeType: 'image/png', sizeBytes: bytes.length, fileName: `${seed}.png` } });
  if (!up.ok) throw new Error(`createUpload: ${problem(up)}`);
  const put = await fetch(up.json.uploadUrl, { method: 'PUT', headers: up.json.uploadHeaders, body: bytes });
  if (!put.ok) throw new Error(`PUT portada: ${put.status}`);
  const done = await request('POST', `${cfg.api}/media/${up.json.mediaId}/complete`, { token: t });
  if (!done.ok && done.status !== 409) throw new Error(`complete: ${problem(done)}`);
  const ok = await poll(async () => { const r = await request('GET', `${cfg.api}/media/${up.json.mediaId}`, { token: t }); return r.ok && r.json.status === 'APPROVED' ? r.json : null; }, { timeoutMs: 60000, intervalMs: 1500 });
  if (!ok) throw new Error('la portada no llegó a APPROVED');
  return up.json.mediaId;
}

for (const e of EVENTS) {
  await report.step(`Evento "${e.title}" (${e.priceCredits} cr., cupo ${e.capacity})`, async () => {
    const t = await token(e.by);
    const list = await request('GET', `${cfg.api}/events?limit=50&from=2000-01-01T00:00:00Z`, { token: t });
    const existing = (list.json?.items ?? []).find((x) => x.title === e.title);
    let id = existing?.id;
    if (!id) {
      const coverMediaId = await uploadCover(t, `paid-${e.key}`, e.cover);
      const c = await request('POST', `${cfg.api}/events`, { token: t, idempotencyKey: stableUuid(`seed:paid:event:${e.key}`), body: { title: e.title, description: e.description, coverMediaId, startsAt: days(e.ahead), venue: e.venue, capacity: e.capacity, priceCredits: e.priceCredits } });
      if (!c.ok) throw new Error(`createEvent: ${problem(c)}`);
      id = c.json.id;
    }
    if (!existing || existing.status !== 'PUBLISHED') {
      const p = await request('POST', `${cfg.api}/events/${id}/publish`, { token: t });
      if (!p.ok && p.status !== 409) throw new Error(`publishEvent: ${problem(p)}`);
    }
    return id;
  });
}
process.exit(report.finish());
