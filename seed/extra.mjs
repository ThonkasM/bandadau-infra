// Datos de demo ampliados (perfiles, seguidores, grupos, publicaciones con foto, comentarios, reacciones,
// eventos con portada, recargas e inscripciones/tickets). Idempotente: re-ejecutable. Lo invoca seed.mjs.
import { cfg } from './lib/env.mjs';
import { request, poll, problem } from './lib/http.mjs';
import { stableUuid } from './lib/ids.mjs';
import { demoPng } from './lib/png.mjs';
import { PROFILES, FOLLOWS, GROUPS_EXTRA, POSTS_EXTRA, COMMENTS, REACTIONS, EVENTS_EXTRA, REGISTRATIONS, TOPUPS } from './lib/demo-data.mjs';

/** Sube una imagen generada y espera a que quede APPROVED. Devuelve el mediaId. */
async function uploadImage(token, { colors, seed, purpose, w = 640, h = 800 }) {
  const bytes = demoPng({ w, h, from: colors[0], to: colors[1], seed });
  // `createUpload` con la misma Idempotency-Key devuelve la URL prefirmada ORIGINAL (puede estar vencida):
  // si el PUT falla (403), se pide una subida nueva con otra clave.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const key = stableUuid(`seed:media:${purpose}:${seed}${attempt ? `:retry${attempt}` : ''}`);
    const up = await request('POST', `${cfg.api}/media/uploads`, {
      token, idempotencyKey: key,
      body: { kind: 'IMAGE', purpose, mimeType: 'image/png', sizeBytes: bytes.length, fileName: `demo-${seed}.png` },
    });
    if (!up.ok) throw new Error(`createUpload: ${problem(up)}`);
    const { mediaId, uploadUrl, uploadHeaders } = up.json;
    // 403 (URL vencida) o error de red (p. ej. una IP LAN antigua guardada en la respuesta idempotente): se reintenta con otra clave.
    const put = await fetch(uploadUrl, { method: 'PUT', headers: uploadHeaders, body: bytes }).catch((e) => ({ ok: false, status: 0, error: e }));
    if ((put.status === 403 || put.status === 0) && attempt < 2) continue;
    if (!put.ok) throw new Error(`PUT ${uploadUrl.split('?')[0]} → ${put.status || put.error?.cause?.code || 'sin conexión'}`);
    const done = await request('POST', `${cfg.api}/media/${mediaId}/complete`, { token });
    if (!done.ok && done.status !== 409) throw new Error(`completeUpload: ${problem(done)}`);
    const asset = await poll(async () => {
      const r = await request('GET', `${cfg.api}/media/${mediaId}`, { token });
      return r.ok && r.json.status === 'APPROVED' ? r.json : null;
    }, { timeoutMs: 60000, intervalMs: 1500 });
    if (!asset) throw new Error(`el medio ${mediaId} no llegó a APPROVED`);
    return mediaId;
  }
  throw new Error('no se pudo subir la imagen tras 3 intentos');
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

export async function seedExtra({ step, ctx, groupId }) {
  const T = (k) => {
    const t = ctx.tokens[k];
    if (!t) throw new Error(`sin sesión de ${k}`);
    return t;
  };

  // 1) Perfiles
  for (const [key, profile] of Object.entries(PROFILES)) {
    await step(`Perfil de ${key}: ${profile.displayName}`, async () => {
      // El perfil se crea de forma asíncrona tras el registro: se reintenta mientras no exista (404).
      let r;
      await poll(async () => {
        r = await request('PATCH', `${cfg.api}/profiles/me`, { token: T(key), body: profile });
        return r.status !== 404;
      }, { timeoutMs: 20000 });
      if (!r.ok) throw new Error(`updateProfile: ${problem(r)}`);
      return 'actualizado';
    });
  }

  // 2) Seguidores
  await step(`Seguidores (${FOLLOWS.length} relaciones)`, async () => {
    let n = 0;
    for (const [from, to] of FOLLOWS) {
      let r;
      await poll(async () => {
        r = await request('PUT', `${cfg.api}/follows/${ctx.users[to].id}`, { token: T(from) });
        return r.status !== 404;
      }, { timeoutMs: 20000 });
      if (!r.ok && r.status !== 409) throw new Error(`follow ${from}→${to}: ${problem(r)}`);
      n += 1;
    }
    return `${n} relaciones`;
  });

  // 3) Grupos
  for (const g of GROUPS_EXTRA) {
    await step(`Grupo "${g.name}"`, async () => {
      const found = await request('GET', `${cfg.api}/groups?query=${encodeURIComponent(g.name)}`, { token: T(g.owner) });
      let id = (found.json?.items ?? []).find((x) => x.name === g.name)?.id;
      if (!id) {
        const c = await request('POST', `${cfg.api}/groups`, { token: T(g.owner), idempotencyKey: stableUuid(`seed:group:${g.name}`), body: { name: g.name, subject: g.subject, privacy: g.privacy } });
        if (!c.ok) throw new Error(`createGroup: ${problem(c)}`);
        id = c.json.id;
      }
      for (const m of g.members) {
        const j = await request('POST', `${cfg.api}/groups/${id}/join`, { token: T(m) });
        if (!j.ok && j.status !== 409) throw new Error(`join ${m}: ${problem(j)}`);
      }
      return `${id} · ${g.members.length} miembros`;
    });
  }

  // 4) Publicaciones (algunas con foto)
  const postIds = {};
  for (const p of POSTS_EXTRA) {
    await step(`Post de ${p.author}${p.image ? ' con foto' : ''}: "${p.text.slice(0, 30)}…"`, async () => {
      const mediaIds = p.image ? [await uploadImage(T(p.author), { ...p.image, purpose: 'POST' })] : [];
      const r = await request('POST', `${cfg.api}/posts`, {
        token: T(p.author), idempotencyKey: stableUuid(`seed:post-key:${p.slug}:${mediaIds.join(',')}`),
        body: { clientId: stableUuid(`seed:post:${p.slug}`), text: p.text, mediaIds, visibility: p.visibility },
      });
      if (!r.ok) throw new Error(`createPost: ${problem(r)}`);
      postIds[p.slug] = r.json.id;
      return r.status === 200 ? 'ya existía' : `creado ${r.json.id}`;
    });
  }

  // 5) Comentarios y reacciones
  await step(`Comentarios (${COMMENTS.length})`, async () => {
    let created = 0;
    for (const [author, slug, text] of COMMENTS) {
      const postId = postIds[slug];
      if (!postId) throw new Error(`post ${slug} no disponible`);
      const existing = await request('GET', `${cfg.api}/posts/${postId}/comments?limit=50`, { token: T(author) });
      if ((existing.json?.items ?? []).some((c) => c.text === text)) continue;
      const r = await request('POST', `${cfg.api}/posts/${postId}/comments`, { token: T(author), idempotencyKey: stableUuid(`seed:comment:${slug}:${author}:${text}`), body: { text } });
      if (!r.ok) throw new Error(`comment ${slug}: ${problem(r)}`);
      created += 1;
    }
    return `${created} nuevos`;
  });
  await step('Reacciones', async () => {
    let n = 0;
    for (const [users, slug, type] of REACTIONS) {
      for (const u of users) {
        const r = await request('PUT', `${cfg.api}/posts/${postIds[slug]}/reactions/me`, { token: T(u), body: { type } });
        if (!r.ok) throw new Error(`reaction ${u}/${slug}: ${problem(r)}`);
        n += 1;
      }
    }
    return `${n} reacciones`;
  });

  // 5b) Recargas de saldo
  for (const [user, pkg] of TOPUPS) {
    await step(`Recarga de ${user}: ${pkg}`, async () => {
      const entries = await request('GET', `${cfg.api}/wallet/me/entries?limit=50`, { token: T(user) });
      if (entries.ok && (entries.json.items ?? []).some((e) => String(e.operationRef).startsWith('TOPUP:'))) {
        const w = await request('GET', `${cfg.api}/wallet/me`, { token: T(user) });
        return `ya recargada (saldo ${w.json?.balanceCredits})`;
      }
      const top = await request('POST', `${cfg.api}/wallet/topups`, { token: T(user), idempotencyKey: stableUuid(`seed:topup:${user}:${pkg}`), body: { package: pkg } });
      if (!top.ok) throw new Error(`createTopUp: ${problem(top)}`);
      const pay = await request('POST', `${cfg.api}/wallet/topups/${top.json.topUpId}/simulate-payment`, { token: T(user), body: { outcome: 'PAID' } });
      if (!pay.ok && pay.status !== 409) throw new Error(`simulate-payment: ${problem(pay)}`);
      const w = await poll(async () => {
        const r = await request('GET', `${cfg.api}/wallet/me`, { token: T(user) });
        return r.ok && r.json.balanceCredits > 0 ? r.json : null;
      }, { timeoutMs: 20000 });
      return `saldo ${w?.balanceCredits ?? '?'}`;
    });
  }

  // 6) Eventos con portada
  for (const e of EVENTS_EXTRA) {
    await step(`Evento "${e.title}" (${e.priceCredits} cr., cupo ${e.capacity})`, async () => {
      const t = T(e.by);
      const existing = (await listAllEvents(t)).find((x) => x.title === e.title);
      if (existing && existing.status === 'PUBLISHED') return `ya publicado ${existing.id}`;
      let id = existing?.id;
      if (!id) {
        const coverMediaId = await uploadImage(t, { ...e.cover, purpose: 'EVENT_COVER', w: 960, h: 540 });
        const c = await request('POST', `${cfg.api}/events`, {
          token: t, idempotencyKey: stableUuid(`seed:event:${e.title}`),
          body: { title: e.title, description: e.description, coverMediaId, startsAt: e.startsAt(), venue: e.venue, capacity: e.capacity, priceCredits: e.priceCredits },
        });
        if (!c.ok) throw new Error(`createEvent: ${problem(c)}`);
        id = c.json.id;
      }
      const p = await request('POST', `${cfg.api}/events/${id}/publish`, { token: t });
      if (!p.ok) throw new Error(`publishEvent: ${problem(p)}`);
      return `publicado ${id}`;
    });
  }

  // 6b) Limpieza: cancela los eventos que dejan los smoke tests y n8n para que el catálogo de demo quede limpio
  await step('Limpieza de eventos de pruebas (Smoke…, n8n…)', async () => {
    const t = T('org');
    const noise = (await listAllEvents(t)).filter((x) => x.status === 'PUBLISHED' && /^(Smoke |n8n recordatorio)/.test(x.title));
    let n = 0;
    for (const ev of noise) {
      const r = await request('POST', `${cfg.api}/events/${ev.id}/cancel`, { token: t, idempotencyKey: stableUuid(`seed:cancel:${ev.id}`), body: { reason: 'Evento de pruebas automatizadas' } });
      if (r.ok) n += 1;
    }
    return `${n}/${noise.length} cancelados`;
  });

  // 7) Inscripciones → tickets (SAGA asíncrona)
  const all = await listAllEvents(T('org'));
  for (const [user, title] of REGISTRATIONS) {
    await step(`Inscripción de ${user}: ${title}`, async () => {
      const ev = all.find((x) => x.title === title) ?? (await listAllEvents(T(user))).find((x) => x.title === title);
      if (!ev) throw new Error(`evento "${title}" no encontrado`);
      const r = await request('POST', `${cfg.api}/events/${ev.id}/registrations`, { token: T(user), idempotencyKey: stableUuid(`seed:reg:${user}:${title}`) });
      if (r.status === 409) return 'ya inscrito';
      if (!r.ok) throw new Error(`register: ${problem(r)}`);
      const id = r.json.id ?? r.json.registrationId;
      const final = await poll(async () => {
        const g = await request('GET', `${cfg.api}/registrations/${id}`, { token: T(user) });
        return g.ok && g.json.status !== 'PENDING' ? g.json : null;
      }, { timeoutMs: 45000, intervalMs: 1500 });
      if (!final) throw new Error(`la inscripción ${id} sigue PENDING`);
      if (final.status !== 'CONFIRMED') throw new Error(`inscripción ${final.status}${final.failureReason ? ` (${final.failureReason})` : ''}`);
      return `CONFIRMED ${id}`;
    });
  }
}
