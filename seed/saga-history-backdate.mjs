#!/usr/bin/env node
// Paso 2 de 2 del historial de demo: mueve hacia el pasado las fechas de los eventos "realizados" y de todo lo que
// generaron sus inscripciones (SAGA, libro mayor del wallet, recargas y tickets con asistencia).
// ES UN SCRIPT DE DEMO que escribe directo en las bases (la API no permite eventos pasados ni escaneos fuera de
// ventana): no es un patrón para código de producto. Es idempotente: las fechas son absolutas (días atrás desde hoy).
//   HISTORY_PSQL   comando que ejecuta psql leyendo SQL por stdin (defecto: Postgres local de Compose)
//   HISTORY_DYNAMO "aws"  (defecto) | "none" para omitir tickets; TICKETING_TABLE (defecto bandada-ticketing)
//   --dry          imprime el SQL y no escribe nada
import { spawnSync } from 'node:child_process';
import { HISTORY_EVENTS, HISTORY_TOPUP_USERS, topupKey } from './lib/history-data.mjs';
import { stableUuid } from './lib/ids.mjs';

const DRY = process.argv.includes('--dry');
const PSQL = process.env.HISTORY_PSQL ?? 'docker exec -i bandada-postgres-1 psql -U postgres -v ON_ERROR_STOP=1 -qAt';
const TABLE = process.env.TICKETING_TABLE ?? 'bandada-ticketing';
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

function psql(db, text) {
  if (DRY) { console.log(`-- [${db}]\n${text}\n`); return ''; }
  const r = spawnSync('bash', ['-c', `${PSQL} -d ${db}`], { input: text, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`psql ${db}: ${r.stderr || r.stdout}`);
  return r.stdout;
}

const past = HISTORY_EVENTS.filter((e) => e.daysAgo).map((e, i) => ({ ...e, idx: i + 1 }));
const startOf = (ago) => { const d = new Date(); d.setUTCHours(22, 0, 0, 0); return new Date(d.getTime() - ago * 86400000); };

// ---- events_db -------------------------------------------------------------------------------------------------------
const eventsSql = `
BEGIN;
CREATE TEMP TABLE h(title text, ago int) ON COMMIT DROP;
INSERT INTO h VALUES ${past.map((e) => `(${q(e.title)}, ${e.daysAgo})`).join(', ')};
CREATE TEMP TABLE e ON COMMIT DROP AS
  SELECT ev.id, (date_trunc('day', now()) - make_interval(days => h.ago) + interval '22 hours') AS s
  FROM events ev JOIN h ON h.title = ev.title;
UPDATE events ev SET starts_at = e.s, ends_at = e.s + interval '3 hours', created_at = e.s - interval '14 days',
  published_at = e.s - interval '13 days', updated_at = e.s + interval '3 hours', status = 'FINISHED'
  FROM e WHERE ev.id = e.id;
CREATE TEMP TABLE r ON COMMIT DROP AS
  SELECT rg.id, e.s,
    e.s - interval '3 days' + row_number() OVER (PARTITION BY rg.event_id ORDER BY rg.created_at, rg.id) * interval '7 hours'
      + (abs(hashtext(rg.id::text)) % 50) * interval '1 minute' AS nc
  FROM registrations rg JOIN e ON e.id = rg.event_id;
UPDATE registrations rg SET created_at = r.nc,
  confirmed_at = CASE WHEN rg.confirmed_at IS NULL THEN NULL ELSE r.nc + interval '3 seconds' END,
  cancelled_at = CASE WHEN rg.cancelled_at IS NULL THEN NULL ELSE r.nc + interval '20 hours' END,
  updated_at = CASE WHEN rg.cancelled_at IS NULL THEN r.nc + interval '4 seconds' ELSE r.nc + interval '20 hours 4 seconds' END
  FROM r WHERE rg.id = r.id;
UPDATE saga_instances sg SET
  started_at = x.sa, updated_at = x.sa + interval '4 seconds',
  finished_at = CASE WHEN sg.finished_at IS NULL THEN NULL ELSE x.sa + interval '4 seconds' END,
  deadline_at = CASE WHEN sg.deadline_at IS NULL THEN NULL ELSE x.sa + interval '2 minutes' END,
  next_retry_at = CASE WHEN sg.next_retry_at IS NULL THEN NULL ELSE x.sa + interval '30 seconds' END
  FROM (SELECT s2.id, CASE WHEN s2.type = 'CANCELLATION' THEN r.nc + interval '20 hours' ELSE r.nc END AS sa
        FROM saga_instances s2 JOIN r ON r.id = s2.registration_id) x
  WHERE sg.id = x.id;
SELECT coalesce(json_agg(json_build_object('id', rg.id, 'userId', rg.user_id, 'status', rg.status, 'ticketId', rg.ticket_id,
  'createdAt', rg.created_at, 'cancelledAt', rg.cancelled_at, 'startsAt', ev.starts_at, 'endsAt', ev.ends_at,
  'organizerId', ev.organizer_id, 'title', ev.title)), '[]'::json)
  FROM registrations rg JOIN events ev ON ev.id = rg.event_id JOIN e ON e.id = ev.id;
COMMIT;`;
const regs = JSON.parse(DRY ? '[]' : psql('events_db', eventsSql).trim().split('\n').filter((l) => l.startsWith('[')).pop() ?? '[]');
console.log(`events_db: ${past.length} eventos pasados, ${regs.length} inscripciones movidas`);

// ---- wallet_db -------------------------------------------------------------------------------------------------------
const first = startOf(past[0].daysAgo);
const fourth = startOf((past[3] ?? past.at(-1)).daysAgo);
const topups = HISTORY_TOPUP_USERS.flatMap((u, i) => [1, 2].map((n) => ({
  key: stableUuid(topupKey(u, n)),
  at: new Date((n === 1 ? first.getTime() - 4 * 86400000 : fourth.getTime() - 4 * 86400000) + i * 13 * 60000).toISOString(),
})));
const walletSql = `
BEGIN;
CREATE TEMP TABLE rr(id uuid, created timestamptz, cancelled timestamptz) ON COMMIT DROP;
${regs.length ? `INSERT INTO rr VALUES ${regs.map((r) => `('${r.id}', '${r.createdAt}', ${r.cancelledAt ? `'${r.cancelledAt}'` : 'NULL'})`).join(', ')};` : ''}
CREATE TEMP TABLE tk(key uuid, at timestamptz) ON COMMIT DROP;
INSERT INTO tk VALUES ${topups.map((t) => `('${t.key}', '${t.at}')`).join(', ')};
UPDATE ledger_entries l SET created_at = CASE l.type WHEN 'DEBIT' THEN rr.created + interval '2 seconds'
  ELSE coalesce(rr.cancelled, rr.created) + interval '3 seconds' END
  FROM rr WHERE l.registration_id = rr.id;
UPDATE ledger_entries l SET created_at = tk.at + interval '3 seconds'
  FROM top_ups t JOIN tk ON tk.key = t.idempotency_key WHERE l.top_up_id = t.id;
UPDATE top_ups t SET created_at = tk.at, paid_at = tk.at + interval '3 seconds', updated_at = tk.at + interval '3 seconds',
  expires_at = tk.at + interval '30 minutes' FROM tk WHERE t.idempotency_key = tk.key;
-- balance_after cronológico por billetera afectada (el saldo final no cambia: se verifica abajo)
CREATE TEMP TABLE aff ON COMMIT DROP AS
  SELECT DISTINCT wallet_user_id FROM ledger_entries l
  WHERE l.registration_id IN (SELECT id FROM rr) OR l.top_up_id IN (SELECT id FROM top_ups t JOIN tk ON tk.key = t.idempotency_key);
UPDATE ledger_entries l SET balance_after = s.b FROM (
  SELECT id, sum(CASE WHEN type = 'DEBIT' THEN -amount_credits ELSE amount_credits END)
         OVER (PARTITION BY wallet_user_id ORDER BY created_at, id) AS b
  FROM ledger_entries WHERE wallet_user_id IN (SELECT wallet_user_id FROM aff)) s
  WHERE l.id = s.id AND l.balance_after <> s.b;
DO $$ DECLARE bad int; BEGIN
  SELECT count(*) INTO bad FROM wallets w WHERE w.user_id IN (SELECT wallet_user_id FROM aff)
    AND w.balance_credits <> (SELECT balance_after FROM ledger_entries l WHERE l.wallet_user_id = w.user_id ORDER BY created_at DESC, id DESC LIMIT 1);
  IF bad > 0 THEN RAISE EXCEPTION 'saldo final inconsistente en % billeteras', bad; END IF;
END $$;
SELECT (SELECT count(*) FROM aff) AS wallets;
COMMIT;`;
console.log(`wallet_db: billeteras afectadas ${psql('wallet_db', walletSql).trim() || '(dry)'}`);

// ---- DynamoDB (tickets) ------------------------------------------------------------------------------------------------
if ((process.env.HISTORY_DYNAMO ?? 'aws') === 'none' || DRY) { console.log('DynamoDB: omitido'); process.exit(0); }
let tickets = 0, used = 0;
for (const r of regs.filter((x) => x.ticketId)) {
  const h = Math.abs([...r.ticketId].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7));
  const attended = r.status === 'CONFIRMED' && h % 10 < 8; // ~80 % de los inscritos llega
  const issued = new Date(new Date(r.createdAt).getTime() + 3000).toISOString();
  const starts = new Date(r.startsAt).toISOString();
  const vals = { ':s': { S: starts }, ':e': { S: new Date(r.endsAt).toISOString() }, ':i': { S: issued },
    ':g1': { S: `STARTS#${starts}#${r.ticketId}` }, ':g3': { S: `ISSUED#${issued}#${r.ticketId}` } };
  let expr = 'SET eventStartsAt = :s, eventEndsAt = :e, issuedAt = :i, gsi1sk = :g1, gsi3sk = :g3';
  const names = {};
  if (attended) {
    expr += ', #st = :used, usedAt = :u, usedBy = :b';
    names['#st'] = 'status';
    vals[':used'] = { S: 'USED' };
    vals[':u'] = { S: new Date(new Date(r.startsAt).getTime() + (5 + (h % 35)) * 60000).toISOString() };
    vals[':b'] = { S: r.organizerId };
    vals[':issued'] = { S: 'ISSUED' };
  }
  const args = ['dynamodb', 'update-item', '--region', process.env.AWS_REGION ?? 'us-east-1', '--table-name', TABLE,
    '--key', JSON.stringify({ pk: { S: `TICKET#${r.ticketId}` }, sk: { S: 'META' } }),
    '--update-expression', expr, '--expression-attribute-values', JSON.stringify(vals),
    '--condition-expression', attended ? 'attribute_exists(pk) AND (#st = :issued OR #st = :used)' : 'attribute_exists(pk)'];
  if (Object.keys(names).length) args.push('--expression-attribute-names', JSON.stringify(names));
  const out = spawnSync('aws', args, { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`ticket ${r.ticketId}: ${out.stderr}`);
  tickets += 1;
  if (attended) used += 1;
}
console.log(`DynamoDB: ${tickets} tickets con fechas movidas, ${used} marcados como asistidos (USED)`);
