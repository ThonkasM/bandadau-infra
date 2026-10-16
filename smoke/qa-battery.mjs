#!/usr/bin/env node
// Batería de regresión del agente de reportes (UC-19, modo Q&A): ≥ 40 preguntas es/en contra el stack real.
//   make qa                                    # todas, motor AUTO
//   node smoke/qa-battery.mjs --engine=OPENCODE --n=10 --filter=usuarios --json
// Por pregunta: inicia sesión de nuevo (el token del admin caduca a los 15 min), pide el reporte por GraphQL, espera READY y puntúa:
//   D  respuesta directa  (la primera línea responde: no es un título ni un preámbulo «Período analizado: …»)
//   A  sin disculpa       (sin «retiro / aclaro / tienes razón / reporte anterior…»)
//   G  sin resumen genérico (salvo en las preguntas que piden un resumen)
//   T  cifra o nombre esperado verificado contra una consulta INDEPENDIENTE (la herramienta MCP llamada directo con el mismo token),
//      o contra una expresión esperada cuando el dato cambia con el tiempo; «-» = no verificable.
// Resumen: tasa de D/A/G/T, p50/p95 de segundos y de tokens. Sale con código 1 si la tasa de respuestas directas es < 90 %
// (`--min-direct=<n>`). No forma parte de `make smoke` (es lenta: decenas de llamadas al LLM).
import { cfg, env } from '../seed/lib/env.mjs';
import { login } from '../seed/lib/identity.mjs';
import { request, sleep } from '../seed/lib/http.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const ENGINE = opt('engine', 'AUTO').toUpperCase();
const LIMIT = Number(opt('n', '0')) || Infinity;
const FILTER = opt('filter', '') ? new RegExp(opt('filter', ''), 'i') : null;
const MIN_DIRECT = Number(opt('min-direct', env('QA_MIN_DIRECT', '90')));
const TIMEOUT_S = Number(opt('timeout', '180'));
const AS_JSON = args.includes('--json');
const EMAIL = env('QA_ADMIN_EMAIL', 'admin@umsa.edu.bo');

const DAY = 86_400_000;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const nowUtc = () => Date.parse(`${ymd(Date.now())}T00:00:00Z`);
const mondayOf = (ms) => ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY;
const mcpUrl = `${cfg.api.replace(/\/api\/v1$/, '')}/mcp`;

// ---- consultas independientes: la herramienta MCP llamada directo (no pasa por el LLM) ----
const mcp = async (token, name, input) => {
  const r = await request('POST', mcpUrl, { token, headers: { Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' }, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } } });
  if (!r.ok || r.json?.result?.isError) throw new Error(`${name}: ${r.status} ${(r.text ?? '').slice(0, 120)}`);
  return r.json.result.structuredContent;
};
const week = () => ({ from: ymd(mondayOf(nowUtc())), to: ymd(nowUtc()) });
const last30 = () => ({ from: ymd(nowUtc() - 29 * DAY), to: ymd(nowUtc()) });
const wide = () => ({ from: ymd(nowUtc() - 364 * DAY), to: ymd(nowUtc()) });
const today = () => ({ from: ymd(nowUtc()), to: ymd(nowUtc()) });
const yesterday = () => ({ from: ymd(nowUtc() - DAY), to: ymd(nowUtc() - DAY) });

/**
 * [pregunta, idioma, opciones]: `truth(mcp)` devuelve lo que la respuesta debe contener (números o textos);
 * `expect` es una expresión sobre el texto cuando el dato cambia con el tiempo; `summary` = pide un resumen (formato de reporte).
 */
const QUESTIONS = [
  ['¿Cuál es el usuario con más créditos?', 'es', { truth: async (c) => [(await c('get_wallet_overview', { limit: 1 })).topBalances[0].balanceCredits] }],
  ['¿Quién tiene el saldo más alto?', 'es', { truth: async (c) => [(await c('get_wallet_overview', { limit: 1 })).topBalances[0].balanceCredits] }],
  ['¿Cuántos créditos hay en circulación en total?', 'es', { truth: async (c) => [(await c('get_wallet_overview', { limit: 1 })).creditsInCirculation] }],
  ['¿Cuántos créditos se recargaron esta semana?', 'es', { truth: async (c) => [(await c('get_credit_stats', { ...week(), groupBy: 'day' })).totals.topUpCredits] }],
  ['¿Cuántos reembolsos hubo este mes?', 'es', { truth: async (c) => [(await c('get_credit_stats', { from: `${ymd(nowUtc()).slice(0, 8)}01`, to: ymd(nowUtc()), groupBy: 'day' })).totals.refundCount] }],
  ['¿Cuántos créditos se gastaron hoy?', 'es', { truth: async (c) => [(await c('get_credit_stats', { ...today(), groupBy: 'day' })).totals.debitCredits] }],
  ['¿Cuántos usuarios hay registrados en total?', 'es', { truth: async (c) => [(await c('get_user_stats', {})).totalUsers] }],
  ['¿Cuántos usuarios están suspendidos?', 'es', { truth: async (c) => [(await c('get_user_stats', {})).suspendedUsers] }],
  ['¿Cuántos usuarios hay por universidad?', 'es', { truth: async (c) => (await c('get_user_stats', {})).byUniversity.slice(0, 1).flatMap((u) => [u.users]) }],
  ['¿Qué carrera tiene más usuarios?', 'es', { truth: async (c) => [(await c('get_user_stats', {})).byCareer[0].career] }],
  ['¿Cuántos usuarios activos hubo ayer?', 'es', { truth: async (c) => [(await c('get_platform_kpis', yesterday())).activeUsers] }],
  ['¿Cuántos usuarios nuevos hubo esta semana?', 'es', { truth: async (c) => [(await c('get_platform_kpis', week())).newUsers] }],
  ['¿Cuántos eventos hay publicados?', 'es', { expect: /\b\d+\b/ }],
  ['¿Cuáles son los próximos eventos?', 'es', { expect: /\b\d+\b|no hay/i }],
  ['¿Qué evento tiene el cupo más lleno?', 'es', { truth: async (c) => [(await c('get_event_ranking', { ...wide(), by: 'FILL_RATE', limit: 1 })).items[0]?.title] }],
  ['¿Qué eventos no tienen inscritos?', 'es', { expect: /\b\d+\b|todos|ning/i }],
  ['¿Cuánto ingreso generó el Taller de Docker?', 'es', { expect: /\b\d+\b/ }],
  ['Top 3 eventos por ingresos', 'es', { truth: async (c) => [(await c('get_event_ranking', { ...wide(), by: 'REVENUE', limit: 3 })).items[0]?.title] }],
  ['¿Cuántos tickets se han emitido?', 'es', { truth: async (c) => [(await c('get_ticket_stats', wide())).issued] }],
  ['¿Cuántos tickets fueron usados?', 'es', { truth: async (c) => [(await c('get_ticket_stats', wide())).used] }],
  ['¿Qué evento tuvo más asistencia?', 'es', { truth: async (c) => [(await c('get_event_ranking', { ...wide(), by: 'ATTENDANCE', limit: 1 })).items[0]?.title] }],
  ['¿Cuántas inscripciones fallaron esta semana?', 'es', { truth: async (c) => [(await c('get_registration_stats', { ...week(), groupBy: 'day' })).totals.failed] }],
  ['¿Cuántas inscripciones se cancelaron este mes?', 'es', { truth: async (c) => [(await c('get_registration_stats', { from: `${ymd(nowUtc()).slice(0, 8)}01`, to: ymd(nowUtc()), groupBy: 'day' })).totals.cancelled] }],
  ['¿Cuántas publicaciones hubo hoy?', 'es', { truth: async (c) => [(await c('get_platform_kpis', today())).posts] }],
  ['¿Cuáles son los hashtags más usados?', 'es', { truth: async (c) => [(await c('get_content_rankings', { ...last30(), by: 'HASHTAGS', limit: 1 })).hashtags?.[0]?.hashtag] }],
  ['¿Quién publicó más esta semana?', 'es', { truth: async (c) => [(await c('get_content_rankings', { ...week(), by: 'AUTHORS', limit: 1 })).authors?.[0]?.posts] }],
  ['¿Qué publicación tiene más reacciones?', 'es', { truth: async (c) => [(await c('get_content_rankings', { ...last30(), by: 'POSTS', limit: 1 })).posts?.[0]?.reactions] }],
  ['¿Cuántos comentarios hubo ayer?', 'es', { truth: async (c) => [(await c('get_platform_kpis', yesterday())).comments] }],
  ['¿Hay contenido pendiente de moderación?', 'es', { truth: async (c) => [(await c('list_flagged_content', { source: 'ALL', limit: 1 })).totalPending] }],
  ['¿Cuántas denuncias abiertas hay?', 'es', { truth: async (c) => [(await c('list_flagged_content', { source: 'ALL', limit: 1 })).totalPending] }],
  ['¿Cómo están los servicios?', 'es', { expect: /operativ|funcion|respond|degrad|ca[ií]d|UP|DOWN/i }],
  ['¿Hay mensajes en las colas de error?', 'es', { expect: /\bno hay\b|\b\d+\b|mensajes/i }],
  ['¿Qué sagas fallaron hoy?', 'es', { truth: async (c) => [(await c('list_failed_sagas', { since: `${ymd(nowUtc())}T00:00:00Z`, limit: 50 })).count] }],
  ['Compara las inscripciones de esta semana con la semana pasada', 'es', { truth: async (c) => [(await c('get_registration_stats', { ...week(), groupBy: 'day' })).totals.confirmed] }],
  ['¿Cuál fue el día con más inscripciones del último mes?', 'es', { expect: /\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{4}-\d{2}-\d{2}\b|no hubo|ning/i }],
  ['¿Cuál es el promedio de créditos por inscripción?', 'es', { expect: /\b\d+(?:[.,]\d+)?\b/ }],
  ['¿Quién gastó más créditos esta semana?', 'es', { truth: async (c) => [(await c('get_top_credit_spenders', { ...week(), limit: 1 })).items?.[0]?.creditsSpent] }],
  ['¿Quién compró el último ticket?', 'es', { expect: /\b[A-ZÁÉÍÓÚÑ][\p{L}]+\b/u }],
  ['Dame un resumen de la semana', 'es', { summary: true }],
  ['Who has the highest credit balance?', 'en', { truth: async (c) => [(await c('get_wallet_overview', { limit: 1 })).topBalances[0].balanceCredits] }],
  ['How many credits are in circulation?', 'en', { truth: async (c) => [(await c('get_wallet_overview', { limit: 1 })).creditsInCirculation] }],
  ['How many users are suspended?', 'en', { truth: async (c) => [(await c('get_user_stats', {})).suspendedUsers] }],
  ['Which university has the most users?', 'en', { truth: async (c) => [(await c('get_user_stats', {})).byUniversity[0].name] }],
  ['How many tickets were used?', 'en', { truth: async (c) => [(await c('get_ticket_stats', wide())).used] }],
  ['Top 3 events by revenue', 'en', { truth: async (c) => [(await c('get_event_ranking', { ...wide(), by: 'REVENUE', limit: 3 })).items[0]?.title] }],
  ['Which event has the fullest seats?', 'en', { truth: async (c) => [(await c('get_event_ranking', { ...wide(), by: 'FILL_RATE', limit: 1 })).items[0]?.title] }],
  ['What are the most used hashtags?', 'en', { truth: async (c) => [(await c('get_content_rankings', { ...last30(), by: 'HASHTAGS', limit: 1 })).hashtags?.[0]?.hashtag] }],
  ['What is the platform health?', 'en', { expect: /operational|healthy|degraded|down|up|respond/i }],
  ['Are there messages in the error queues?', 'en', { expect: /\bno\b|\b\d+\b|messages/i }],
  ['Compare this week registrations with last week', 'en', { expect: /\b\d+\b/ }],
  ['How many posts were there today?', 'en', { truth: async (c) => [(await c('get_platform_kpis', today())).posts] }],
];

// ---- puntuación ----
const CHATTER = [
  /\b(retiro|retiré|retira|se retira[n]?|aclaro|aclaraci[oó]n|disculp\w*|perd[oó]n|lamento|lo siento|corrijo|rectifico)\b/i,
  /tienes raz[oó]n/i,
  /\b(reporte|respuesta|informe|resumen)\s+(anterior|previ[oa])\b/i,
  /verificaci[oó]n\s+(de\s+)?(cifras|n[uú]meros|datos)|no (aparece|figura)[n]? en (ning[uú]n|los) resultado/i,
  /\b(i apologi[sz]e|sorry|you(?:'re| are) right|i (retract|withdraw)|previous (report|answer|response))\b/i,
];
const firstLine = (md) => (md ?? '').split('\n').find((l) => l.trim()) ?? '';
const isDirect = (md) => {
  const l = firstLine(md).trim();
  return l.length >= 8 && !l.startsWith('#') && !/^[*_\s>-]*(per[ií]odo|period|fecha|date|consulta|query|rango|range|resumen|summary|datos|data|herramienta|tool)\b[^:]{0,30}:/i.test(l);
};
const isGeneric = (r) => /Resumen de la plataforma|Platform summary/i.test(`${r.title ?? ''}\n${firstLine(r.markdown)}`);
const numbersOf = (text) => [...(text ?? '').matchAll(/-?\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.')));
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const contains = (md, wanted) => {
  if (wanted === undefined || wanted === null) return true; // sin dato independiente (p. ej. lista vacía): no se puede contradecir
  if (typeof wanted === 'number') {
    if (wanted === 0) return /\b0\b|ning[uú]n|ninguna|\bno\b|\bsin\b|none|nothing|\bnot\b|vac[ií]a|empty/i.test(md);
    return numbersOf(md).some((n) => n === wanted || Math.abs(n - wanted) <= Math.abs(wanted) * 0.01);
  }
  return norm(md).includes(norm(wanted));
};

const percentile = (xs, p) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};
const gqlOnce = async (token, query, variables) => {
  for (let i = 0; i < 8; i++) {
    const r = await request('POST', cfg.graphql, { token, headers: { 'x-bandada-client': 'admin' }, body: { query, variables }, timeoutMs: 30000 }).catch(() => null);
    if (r?.json) return r.json;
    await sleep(3000); // el gateway puede estar reiniciándose
  }
  return null;
};

const REQUEST = 'mutation($q:String!,$l:Locale,$e:ReportEngine){requestReport(question:$q,locale:$l,engine:$e){report{id}}}';
const REPORT = 'query($id:UUID!){report(id:$id){status title markdown failureReason engine model createdAt completedAt agentRun{tokens{total}}}}';

async function ask(question, locale) {
  const session = await login(EMAIL, cfg.password, 'admin'); // sesión renovada por pregunta (el token caduca a los 15 min)
  const token = session.json.accessToken;
  const t0 = Date.now();
  const sent = await gqlOnce(token, REQUEST, { q: question, l: locale, e: ENGINE });
  const id = sent?.data?.requestReport?.report?.id;
  if (!id) return { token, error: `requestReport: ${JSON.stringify(sent?.errors ?? sent).slice(0, 160)}`, secs: 0 };
  let rep = null;
  for (let i = 0; i < TIMEOUT_S; i++) {
    await sleep(1000);
    rep = (await gqlOnce(token, REPORT, { id }))?.data?.report;
    if (rep && (rep.status === 'READY' || rep.status === 'FAILED')) break;
  }
  return { token, rep, secs: Math.round((Date.now() - t0) / 100) / 10 };
}

const selected = QUESTIONS.filter(([q]) => !FILTER || FILTER.test(q)).slice(0, LIMIT);
const rows = [];
console.log(`QA del agente de reportes · motor ${ENGINE} · ${selected.length} preguntas · ${cfg.graphql}`);
for (const [question, locale, o] of selected) {
  const { token, rep, secs, error } = await ask(question, locale);
  const md = rep?.markdown ?? '';
  const ok = rep?.status === 'READY';
  const D = ok && (o.summary ? md.trim().length > 0 : isDirect(md)); // un resumen explícito conserva el formato de reporte
  const A = ok && !CHATTER.some((re) => re.test(md));
  const G = ok && (o.summary ? true : !isGeneric(rep));
  let T = null;
  let truthNote = '';
  if (ok && o.truth) {
    try {
      const wanted = (await o.truth((name, input) => mcp(token, name, input))).filter((x) => x !== undefined);
      T = wanted.every((w) => contains(md, w));
      if (!T) truthNote = `esperaba ${JSON.stringify(wanted)}`;
    } catch (e) {
      truthNote = `sin verificar (${String(e.message).slice(0, 60)})`;
    }
  } else if (ok && o.expect) {
    T = o.expect.test(md);
    if (!T) truthNote = `esperaba ${o.expect}`;
  }
  const tokens = rep?.agentRun?.tokens?.total ?? 0;
  rows.push({ question, locale, status: error ?? rep?.status ?? 'TIMEOUT', secs, tokens, model: rep?.model ?? '-', D, A, G, T, first: firstLine(md).slice(0, 110), note: truthNote || rep?.failureReason || '' });
  const r = rows.at(-1);
  const flag = (v) => (v === null ? '-' : v ? '✓' : '✗');
  console.log(`${String(rows.length).padStart(2)} ${flag(r.D)}${flag(r.A)}${flag(r.G)}${flag(r.T)} ${String(r.secs).padStart(5)}s ${String(r.tokens).padStart(6)}t ${r.model.slice(0, 26).padEnd(26)} ${question.slice(0, 52).padEnd(52)} | ${r.first.slice(0, 80)}${r.note ? `  [${r.note}]` : ''}`);
}

const n = rows.length || 1;
const rate = (f) => Math.round((rows.filter(f).length / n) * 1000) / 10;
const checked = rows.filter((r) => r.T !== null);
const summary = {
  questions: rows.length,
  engine: ENGINE,
  directRate: rate((r) => r.D),
  noApologyRate: rate((r) => r.A),
  noGenericRate: rate((r) => r.G),
  verifiedRate: checked.length ? Math.round((checked.filter((r) => r.T).length / checked.length) * 1000) / 10 : null,
  verifiedOf: checked.length,
  secondsP50: percentile(rows.map((r) => r.secs), 50),
  secondsP95: percentile(rows.map((r) => r.secs), 95),
  tokensP50: percentile(rows.map((r) => r.tokens), 50),
  tokensP95: percentile(rows.map((r) => r.tokens), 95),
  fallbackToStub: rows.filter((r) => /stub/i.test(r.model)).length,
  failed: rows.filter((r) => r.status !== 'READY').length,
};
console.log('\n=== Resumen ===');
console.log(`Respuesta directa (D)   ${summary.directRate} %   (mínimo ${MIN_DIRECT} %)`);
console.log(`Sin disculpa (A)        ${summary.noApologyRate} %`);
console.log(`Sin resumen genérico (G) ${summary.noGenericRate} %`);
console.log(`Verificadas (T)         ${summary.verifiedRate ?? 'n/a'} %  de ${summary.verifiedOf} verificables`);
console.log(`Tiempo   p50 ${summary.secondsP50} s · p95 ${summary.secondsP95} s`);
console.log(`Tokens   p50 ${summary.tokensP50} · p95 ${summary.tokensP95}`);
console.log(`Con respaldo determinista: ${summary.fallbackToStub} · fallidas: ${summary.failed}`);
if (AS_JSON) console.log(JSON.stringify({ summary, rows }, null, 2));
if (summary.directRate < MIN_DIRECT) {
  console.error(`\nFALLA: la tasa de respuestas directas (${summary.directRate} %) es menor que ${MIN_DIRECT} %`);
  process.exit(1);
}
