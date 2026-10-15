// Estado en memoria del mock + datos semilla. Todo se reconstruye con resetDb().
import { BASE_URL, DEMO_PASSWORD, VERIFY_CODE } from './config.mjs';
import { fid, iso, parseHashtags, tail } from './util.mjs';

export const NS = { univ: 1, user: 2, group: 3, post: 4, media: 5, event: 6, reg: 7, ticket: 8, comment: 9, report: 10, saga: 11, ledger: 12, notif: 13 };
export const asset = (path) => `${BASE_URL}${path}`;

export const db = {};
export const timers = new Set();
export const later = (ms, fn) => {
  const t = setTimeout(() => {
    timers.delete(t);
    try { fn(); } catch (e) { console.error('[mock] timer error', e); }
  }, ms);
  t.unref?.();
  timers.add(t);
  return t;
};

const UNIV = [
  { id: fid(NS.univ, 1), name: 'Universidad Mayor de San Andrés (UMSA)', allowedDomains: ['umsa.edu.bo'] },
  { id: fid(NS.univ, 2), name: 'Universidad Católica Boliviana (UCB)', allowedDomains: ['ucb.edu.bo'] },
];

// [clave, correo, roles, nombre, carrera, semestre, intereses, bio, universidad]
const USERS = [
  ['admin', 'admin@umsa.edu.bo', ['ADMIN'], 'Administración Bandada', null, null, [], 'Cuenta de administración (demo).', 0],
  ['mod', 'mod@umsa.edu.bo', ['MODERATOR'], 'Moderación UMSA', null, null, [], 'Cuenta de moderación (demo).', 0],
  ['org', 'org@umsa.edu.bo', ['ORGANIZER'], 'Centro de Estudiantes UMSA', null, null, ['eventos', 'comunidad'], 'Organizamos los eventos de la facultad.', 0],
  ['lucia', 'lucia@umsa.edu.bo', ['STUDENT'], 'Lucía Mamani', 'Ingeniería de Sistemas', 6, ['programación', 'ia', 'ajedrez'], 'Sexto semestre. Café, código y ajedrez.', 0],
  ['marco', 'marco@umsa.edu.bo', ['STUDENT'], 'Marco Quispe', 'Ingeniería Informática', 4, ['videojuegos', 'redes', 'música'], 'Siempre con un proyecto a medias.', 0],
  ['camila', 'camila@umsa.edu.bo', ['STUDENT'], 'Camila Rojas', 'Arquitectura', 8, ['diseño', 'fotografía'], 'Maquetas, mate y planos.', 0],
  ['diego', 'diego@ucb.edu.bo', ['STUDENT'], 'Diego Flores', 'Diseño Gráfico', 5, ['ilustración', 'cine'], 'Dibujo en los márgenes de los apuntes.', 1],
  ['valeria', 'valeria@ucb.edu.bo', ['STUDENT'], 'Valeria Choque', 'Psicología', 7, ['lectura', 'salud mental'], 'Escuchar también es una carrera.', 1],
  ['andres', 'andres@umsa.edu.bo', ['STUDENT'], 'Andrés Condori', 'Ingeniería Civil', 3, ['fútbol', 'estructuras'], 'Hormigón armado y pichanga los viernes.', 0],
  ['sofia', 'sofia@ucb.edu.bo', ['STUDENT'], 'Sofía Vargas', 'Comunicación Social', 6, ['periodismo', 'podcast'], 'Micrófono en mano.', 1],
];

const POSTS = [
  '¡Ya terminé el parcial de Cálculo II! Ahora sí, a dormir tres días seguidos. #calculo #umsa',
  'Alguien tiene los apuntes de Estructuras de Datos de la semana 5? Los comparto en el grupo. #estudio',
  'Hoy el laboratorio de redes funcionó a la primera. Anótenlo, es histórico. #redes #sistemas',
  'Búsqueda de equipo para la hackatón: necesitamos a alguien de diseño. Escríbeme. #hackaton',
  'Tip de estudio: pomodoros de 25 minutos y un mate entre cada ronda. Cambió mi semestre. #productividad',
  'La feria de proyectos estuvo increíble, felicidades a todos los equipos que expusieron. #feria #ingenieria',
  'Prestamo mi calculadora científica solo a quien me devuelva con pilas nuevas. #humor',
  'Recordatorio: mañana vence la inscripción a materias electivas. No se duerman. #umsa',
  'Terminé mi primer API REST con autenticación. Orgullosa de este pequeño paso. #programacion #backend',
  'El atardecer desde el campus central hoy estaba de postal. #fotografia #lapaz',
  'Se abre el club de ajedrez: martes y jueves a las 18:00 en el aula 204. #ajedrez',
  'Estudiando para finales con la lista de música más lofi del mundo. #lofi #estudio',
  'Qué bueno es tener profesores que explican con ejemplos reales. Gracias, ing. Calle. #gratitud',
  'Primera vez presentando en inglés frente a toda la clase. Sobreviví. #english',
  'Busco compañero de proyecto para Ingeniería de Software II (Grupo 24, ¡ya estamos armados!). #iconix',
  'Diseñé el afiche de la semana cultural. Díganme qué opinan. #diseno #cultura',
  'Un recordatorio amable: tomen agua y descansen la vista de la pantalla. #salud',
  'Hoy aprendí a hacer un join en SQL sin copiar de internet. Pequeñas victorias. #sql #bd',
  'Mesa redonda sobre emprendimiento universitario el viernes. Hay cupo limitado. #emprendimiento',
  'Alguien sabe dónde sacar fotocopias baratas cerca del campus? #ayuda',
  'Mi equipo ganó el torneo interfacultades de fútbol 7. A celebrar con salteñas. #futbol #salteñas',
  'Escribí mi primer algoritmo recursivo sin llorar. Progreso. #algoritmos',
  'Nuevo episodio del podcast universitario: entrevistamos al rector. #podcast',
  'Alguien más piensa que la cafetería necesita más enchufes? #campus',
  'Subí al repositorio las plantillas de informes de laboratorio. Úsenlas con cariño. #recursos',
  'Termina la semana de exámenes y empieza la semana de fotos de comida. #foodie',
  'Charla de salud mental este jueves: hablemos sin tabúes. #saludmental',
  'Gracias a quienes vinieron al taller de Git. ¡Pull request aprobado! #git #github',
  'El viaje de estudios a Oruro fue lo mejor del semestre. #viaje',
  'Reto: ¿quién puede resolver este problema de lógica sin buscar la respuesta? #logica',
];

const FLAG_TEXTS = [
  'Foto de la fiesta del fin de semana, mejor no pregunten. #fiesta',
  'Mi nuevo tatuaje, qué les parece? #arte',
  'Captura del partido de ayer, la tribuna se puso intensa. #futbol',
];

export function resetDb() {
  for (const t of timers) clearTimeout(t);
  timers.clear();
  for (const k of Object.keys(db)) delete db[k];
  const t0 = Date.now();
  const ago = (min) => iso(t0 - min * 60_000);
  const inDays = (d, hour = 15) => {
    const x = new Date(t0 + d * 86_400_000);
    x.setUTCHours(hour, 0, 0, 0);
    return x.toISOString();
  };

  Object.assign(db, {
    universities: new Map(UNIV.map((u) => [u.id, { ...u, enabled: true, createdAt: ago(60 * 24 * 90) }])),
    users: new Map(), byEmail: new Map(), keyToId: {},
    refreshTokens: new Map(), handoffs: new Map(), idempotency: new Map(),
    posts: new Map(), comments: new Map(), reactions: new Map(), follows: new Map(),
    groups: new Map(), memberships: new Map(), reports: new Map(),
    media: new Map(), uploads: new Map(),
    events: new Map(), registrations: new Map(), sagas: new Map(),
    wallets: new Map(), ledger: [], topups: new Map(), tickets: new Map(),
    notifications: [], prefs: new Map(), devices: new Map(),
    fixedStatus: null,
  });

  // --- usuarios ---
  USERS.forEach(([key, email, roles, displayName, career, semester, interests, bio, uIdx], i) => {
    const id = fid(NS.user, i + 1);
    const u = {
      id, email, password: DEMO_PASSWORD, universityId: UNIV[uIdx].id, status: 'ACTIVE', roles,
      locale: 'es', theme: 'SYSTEM', emailVerifiedAt: ago(60 * 24 * 30), createdAt: ago(60 * 24 * 30), updatedAt: ago(60 * 24 * 30),
      displayName, career, semester, interests, bio, avatarMediaId: null, avatarUrl: asset(`/mock-assets/avatars/${i + 1}.png`),
      suspendedAt: null, suspensionReason: null, verifyCode: VERIFY_CODE, verifyAttempts: 0,
    };
    db.users.set(id, u);
    db.byEmail.set(email, id);
    db.keyToId[key] = id;
    db.wallets.set(id, { userId: id, balanceCredits: 0, updatedAt: ago(60 * 24 * 30) });
  });
  const U = db.keyToId;

  // --- grupos ---
  const mkGroup = (n, name, subject, privacy, owner, members) => {
    const id = fid(NS.group, n);
    db.groups.set(id, { id, name, subject, privacy, ownerId: U[owner], createdAt: ago(60 * 24 * 20) });
    db.memberships.set(`${id}:${U[owner]}`, { groupId: id, userId: U[owner], role: 'OWNER', status: 'ACTIVE', requestedAt: ago(60 * 24 * 20), updatedAt: ago(60 * 24 * 20) });
    for (const [k, status = 'ACTIVE'] of members)
      db.memberships.set(`${id}:${U[k]}`, { groupId: id, userId: U[k], role: 'MEMBER', status, requestedAt: ago(60 * 24 * 5), updatedAt: ago(60 * 24 * 5) });
    return id;
  };
  const gCalc = mkGroup(1, 'Cálculo II – UMSA', 'Matemáticas', 'PUBLIC', 'lucia', [['marco'], ['camila'], ['andres']]);
  const gProg = mkGroup(2, 'Club de Programación', 'Computación', 'PUBLIC', 'marco', [['lucia'], ['sofia']]);
  const gFoto = mkGroup(3, 'Fotografía UCB', 'Arte y diseño', 'PRIVATE', 'diego', [['valeria'], ['camila', 'PENDING']]);

  // --- follows ---
  const follow = (a, b, min) => db.follows.set(`${U[a]}>${U[b]}`, { followerId: U[a], followeeId: U[b], createdAt: ago(min) });
  [['lucia', 'marco'], ['lucia', 'org'], ['lucia', 'camila'], ['marco', 'lucia'], ['marco', 'org'], ['camila', 'lucia'],
    ['diego', 'valeria'], ['valeria', 'diego'], ['sofia', 'lucia'], ['andres', 'marco'], ['org', 'lucia']].forEach(([a, b], i) => follow(a, b, 5000 + i * 100));

  // --- media + posts ---
  const authors = ['lucia', 'marco', 'camila', 'diego', 'valeria', 'andres', 'sofia', 'org'];
  const mkMedia = (n, owner, path, status, extra = {}) => {
    const id = fid(NS.media, n);
    db.media.set(id, {
      id, ownerId: U[owner], kind: 'IMAGE', purpose: 'POST', mimeType: 'image/png', sizeBytes: 48_000 + n * 111, durationSeconds: null, status,
      path, tags: [], ocrText: null, createdAt: ago(30 * n), updatedAt: ago(30 * n), moderation: null, ...extra,
    });
    return id;
  };
  const mkPost = (n, authorKey, text, mediaIds, minutesAgo, extra = {}) => {
    const id = fid(NS.post, n);
    db.posts.set(id, {
      id, clientId: fid(NS.post + 100, n), authorId: U[authorKey], text, hashtags: parseHashtags(text), visibility: 'PUBLIC', groupId: null,
      status: 'PUBLISHED', hiddenReason: null, mediaIds, createdAt: ago(minutesAgo), updatedAt: ago(minutesAgo), ...extra,
    });
    db.comments.set(id, []);
    db.reactions.set(id, new Map());
    return id;
  };
  POSTS.forEach((text, i) => {
    const media = i % 3 === 0 ? [mkMedia(i + 1, authors[i % authors.length], `/mock-assets/posts/${(i % 12) + 1}.png`, 'APPROVED', { tags: ['campus'] })] : [];
    mkPost(i + 1, authors[i % authors.length], text, media, 12 + i * 53);
  });
  // posts de grupo
  mkPost(40, 'lucia', 'Ejercicios resueltos de integrales dobles subidos al drive del grupo. #calculo', [], 200, { visibility: 'GROUP', groupId: gCalc });
  mkPost(41, 'marco', 'Esta semana: kata de recursión el miércoles 19:00 en el lab 3. #programacion', [], 320, { visibility: 'GROUP', groupId: gProg });
  mkPost(42, 'diego', 'Salida fotográfica al Valle de la Luna el sábado. Confirmen asistencia. #fotografia', [], 410, { visibility: 'GROUP', groupId: gFoto });
  mkPost(43, 'camila', 'Solo para seguidores: así va mi maqueta final (shhh).', [], 90, { visibility: 'FOLLOWERS' });
  void gFoto;

  // reacciones deterministas
  const RT = ['LIKE', 'HELPFUL', 'FUNNY', 'SUPPORT'];
  const all = Object.values(U);
  for (const p of db.posts.values()) {
    const seed = Number(p.id.slice(-4));
    all.forEach((uid, k) => { if ((seed * 7 + k * 3) % 4 === 0 && uid !== p.authorId) db.reactions.get(p.id).set(uid, RT[(seed + k) % 4]); });
  }
  // comentarios
  const CT = ['¡Felicidades!', 'Gracias por compartir.', 'Yo también quiero ir.', 'Jajaja, totalmente.', '¿Para cuándo la próxima?', 'Buenísimo, me sumo.'];
  [1, 2, 4, 9, 12, 20].forEach((pn, a) => {
    const pid = fid(NS.post, pn);
    for (let c = 0; c < 2 + (a % 3); c++) {
      const id = fid(NS.comment, pn * 10 + c);
      db.comments.get(pid).push({ id, postId: pid, authorId: all[3 + ((a + c) % 6)], text: CT[(a + c) % CT.length], status: 'VISIBLE', parentId: null, createdAt: ago(10 + a * 40 + c * 5) });
    }
  });

  // --- moderación: medios marcados por la "IA" ---
  const FL = [['marco', 0.71, ['nsfw', 'suggestive']], ['camila', 0.64, ['violence']], ['diego', 0.83, ['nsfw']]];
  FL.forEach(([owner, score, labels], i) => {
    const mid = mkMedia(100 + i, owner, `/mock-assets/flagged/${i + 1}.png`, 'FLAGGED', {
      tags: labels, ocrText: i === 1 ? 'PROHIBIDO PASAR' : null, updatedAt: ago(15 + i * 25),
      moderation: { model: 'mock-nsfw', modelVersion: '0.0.1-mock', labels, scores: { [labels[0]]: score, safe: +(1 - score).toFixed(2) }, decision: 'REVIEW', frameIndex: null, createdAt: ago(15 + i * 25), finalDecision: null },
    });
    mkPost(50 + i, owner, FLAG_TEXTS[i], [mid], 16 + i * 25, { status: 'PENDING_MEDIA' });
  });

  // --- denuncias ---
  const mkReport = (n, targetType, targetId, reporter, reason, status = 'OPEN', extra = {}) => {
    const id = fid(NS.report, n);
    db.reports.set(id, { id, targetType, targetId, reporterId: U[reporter], reason, details: null, status, resolution: null, resolutionNote: null, createdAt: ago(60 * n), resolvedAt: null, resolvedBy: null, ...extra });
  };
  const reportedPost = fid(NS.post, 7);
  mkReport(1, 'POST', reportedPost, 'lucia', 'SPAM', 'OPEN', { details: 'Publicidad repetida en el feed.' });
  mkReport(2, 'POST', reportedPost, 'marco', 'SPAM');
  mkReport(3, 'POST', fid(NS.post, 16), 'valeria', 'HARASSMENT', 'OPEN', { details: 'Comentarios ofensivos hacia un compañero.' });
  mkReport(4, 'COMMENT', fid(NS.comment, 10), 'andres', 'OTHER', 'OPEN');
  mkReport(5, 'POST', fid(NS.post, 14), 'sofia', 'MISINFORMATION', 'RESOLVED_KEPT', { resolution: 'KEEP', resolutionNote: 'Revisado: no infringe las normas.', resolvedAt: ago(60 * 20), resolvedBy: U.mod });

  // --- eventos ---
  const mkEvent = (n, title, description, days, venue, capacity, baseTaken, price, status, cover) => {
    const id = fid(NS.event, n);
    db.events.set(id, { id, organizerId: U.org, title, description, coverUrl: asset(`/mock-assets/events/${cover}.png`), startsAt: inDays(days), venue, capacity, baseTaken, priceCredits: price, status, publishedAt: status === 'PUBLISHED' ? ago(60 * 48) : null, createdAt: ago(60 * 72), updatedAt: ago(60 * 48) });
    return id;
  };
  const evHack = mkEvent(1, 'Hackatón UMSA 2026', 'Cuarenta y ocho horas para construir algo útil para la comunidad universitaria. Entrada libre, café incluido.', 12, 'Auditorio de la Facultad de Ciencias Puras, La Paz', 120, 84, 0, 'PUBLISHED', 1);
  const evTaller = mkEvent(2, 'Taller de Git y GitHub', 'De cero a pull request: flujo de trabajo en equipo, ramas y revisión de código. Traer laptop.', 6, 'Laboratorio 3, Edificio Tecnológico', 40, 31, 20, 'PUBLISHED', 2);
  mkEvent(3, 'Mesa redonda: emprendimiento universitario (cupo único)', 'Evento de cupo 1 pensado para probar el error EVENT_FULL: la primera inscripción gana.', 20, 'Sala de reuniones del Centro de Estudiantes', 1, 0, 0, 'PUBLISHED', 3);
  mkEvent(4, 'CHAOS Night: prueba de compensación', 'Evento de demostración: toda inscripción falla en la emisión del ticket y se compensa (reembolso).', 25, 'Patio central', 50, 12, 10, 'PUBLISHED', 4);
  mkEvent(5, 'Borrador: Semana de la Ingeniería', 'Evento en borrador del organizador (aún sin publicar).', 40, 'Por definir', 300, 0, 15, 'DRAFT', 5);

  // --- inscripciones, sagas, tickets, wallet (semilla) ---
  const regRec = (n, eventKey, userKey, status, extra = {}) => {
    const id = fid(NS.reg, n);
    db.registrations.set(id, { id, eventId: eventKey, userId: U[userKey], status, failureReason: null, priceCredits: db.events.get(eventKey).priceCredits, ticketId: null, createdAt: ago(60 * 20), updatedAt: ago(60 * 20), confirmedAt: null, cancelledAt: null, ...extra });
    return id;
  };
  const sagaRec = (regId, status, step, extra = {}) => {
    const r = db.registrations.get(regId);
    const sid = fid(NS.saga, tail(regId));
    db.sagas.set(sid, { id: sid, type: 'REGISTRATION', registrationId: regId, eventId: r.eventId, userId: r.userId, step, status, failureReason: null, retries: 0, deadlineAt: null, startedAt: r.createdAt, updatedAt: r.updatedAt, correlationId: fid(NS.saga + 100, tail(regId)), ...extra });
  };
  const r1 = regRec(1, evHack, 'lucia', 'CONFIRMED', { ticketId: fid(NS.ticket, 1), confirmedAt: ago(60 * 20) });
  sagaRec(r1, 'COMPLETED', 'ISSUE_TICKET');
  db.tickets.set(fid(NS.ticket, 1), { id: fid(NS.ticket, 1), registrationId: r1, eventId: evHack, userId: U.lucia, status: 'ISSUED', issuedAt: ago(60 * 20), usedAt: null, voidedAt: null });
  const r2 = regRec(2, evTaller, 'marco', 'PENDING', { updatedAt: ago(60 * 5) });
  sagaRec(r2, 'FAILED', 'ISSUE_TICKET', { failureReason: 'TIMEOUT', retries: 3, updatedAt: ago(60 * 5) });
  const r3 = regRec(3, evTaller, 'camila', 'CONFIRMED', { ticketId: fid(NS.ticket, 3), confirmedAt: ago(60 * 30), createdAt: ago(60 * 30), updatedAt: ago(60 * 30) });
  sagaRec(r3, 'COMPLETED', 'ISSUE_TICKET');
  db.tickets.set(fid(NS.ticket, 3), { id: fid(NS.ticket, 3), registrationId: r3, eventId: evTaller, userId: U.camila, status: 'USED', issuedAt: ago(60 * 30), usedAt: ago(60 * 2), voidedAt: null });
  const r4 = regRec(4, evTaller, 'sofia', 'FAILED', { failureReason: 'INSUFFICIENT_FUNDS', createdAt: ago(60 * 26), updatedAt: ago(60 * 26) });
  sagaRec(r4, 'COMPENSATED', 'RELEASE_SEAT', { failureReason: 'INSUFFICIENT_FUNDS' });

  const ledger = (userKey, type, amount, ref, desc, minutesAgo, extra = {}) => {
    const w = db.wallets.get(U[userKey]);
    w.balanceCredits += type === 'DEBIT' ? -amount : amount;
    w.updatedAt = ago(minutesAgo);
    db.ledger.push({ id: fid(NS.ledger, db.ledger.length + 1), walletId: fid(NS.ledger + 100, tail(U[userKey])), userId: U[userKey], type, amountCredits: amount, balanceAfterCredits: w.balanceCredits, operationRef: ref, description: desc, registrationId: null, eventId: null, topUpId: null, createdAt: ago(minutesAgo), ...extra });
  };
  ledger('lucia', 'TOPUP', 50, `TOPUP:${fid(NS.ledger + 200, 1)}`, 'Recarga de 50 créditos', 60 * 48, { topUpId: fid(NS.ledger + 200, 1) });
  ledger('lucia', 'TOPUP', 50, `TOPUP:${fid(NS.ledger + 200, 2)}`, 'Recarga de 50 créditos', 60 * 24, { topUpId: fid(NS.ledger + 200, 2) });
  ledger('marco', 'TOPUP', 50, `TOPUP:${fid(NS.ledger + 200, 3)}`, 'Recarga de 50 créditos', 60 * 30, { topUpId: fid(NS.ledger + 200, 3) });
  ledger('camila', 'TOPUP', 20, `TOPUP:${fid(NS.ledger + 200, 4)}`, 'Recarga de 20 créditos', 60 * 40, { topUpId: fid(NS.ledger + 200, 4) });
  ledger('camila', 'DEBIT', 20, `DEBIT:${r3}`, 'Inscripción: Taller de Git y GitHub', 60 * 30, { registrationId: r3, eventId: evTaller });
  for (const [n, k] of [[1, 'lucia'], [2, 'lucia'], [3, 'marco'], [4, 'camila']])
    db.topups.set(fid(NS.ledger + 200, n), { id: fid(NS.ledger + 200, n), userId: U[k], package: n === 4 ? 'CREDITS_20' : 'CREDITS_50', amountCredits: n === 4 ? 20 : 50, priceMinor: n === 4 ? 2000 : 5000, currency: 'BOB', status: 'PAID', gatewayRef: `sim_seed_${n}`, createdAt: ago(60 * 48), paidAt: ago(60 * 48), expiresAt: ago(60 * 47) });

  // --- notificaciones de Lucía y Marco ---
  const nt = (userKey, type, title, body, deepLink, minutesAgo, read = false) =>
    db.notifications.push({ id: fid(NS.notif, db.notifications.length + 1), userId: U[userKey], type, title, body, locale: 'es', data: { deepLink }, readAt: read ? ago(minutesAgo - 1) : null, createdAt: ago(minutesAgo) });
  for (const k of Object.keys(U)) nt(k, 'WELCOME', '¡Bienvenido a Bandada U!', 'Completa tu perfil y empieza a seguir a tu comunidad.', '/profile', 60 * 24 * 30, true);
  ledger('marco', 'DEBIT', 20, `DEBIT:${r2}`, 'Inscripción: Taller de Git y GitHub', 60 * 5, { registrationId: r2, eventId: evTaller });
  nt('lucia', 'TOPUP_PAID', 'Recarga acreditada', 'Se acreditaron 50 créditos a tu billetera.', '/wallet', 60 * 24, true);
  nt('lucia', 'REGISTRATION_CONFIRMED', 'Inscripción confirmada', 'Ya tienes tu entrada para Hackatón UMSA 2026.', `/tickets/${fid(NS.ticket, 1)}`, 60 * 20);
  nt('lucia', 'NEW_FOLLOWER', 'Nuevo seguidor', 'Marco Quispe empezó a seguirte.', `/profiles/${U.marco}`, 90);
  nt('lucia', 'NEW_REACTION', 'Nueva reacción', 'A Camila Rojas le gustó tu publicación.', `/posts/${fid(NS.post, 1)}`, 35);
  nt('lucia', 'EVENT_REMINDER', 'Recordatorio de evento', 'Hackatón UMSA 2026 empieza en 12 días.', `/events/${evHack}`, 20);
  nt('marco', 'REGISTRATION_FAILED', 'No pudimos completar tu inscripción', 'Taller de Git y GitHub: la emisión de tu entrada tardó demasiado.', `/registrations/${r2}`, 60 * 5);
  nt('marco', 'NEW_COMMENT', 'Nuevo comentario', 'Lucía Mamani comentó tu publicación.', `/posts/${fid(NS.post, 2)}`, 120);
  void gProg;
}
