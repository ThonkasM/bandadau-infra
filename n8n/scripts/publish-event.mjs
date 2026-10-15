#!/usr/bin/env node
// Publica un CloudEvent de prueba en el exchange bandada.events vía la API HTTP de gestión de RabbitMQ (sin dependencias).
// Uso: node n8n/scripts/publish-event.mjs <type> '<json data>' [--id <uuid>]
//   node n8n/scripts/publish-event.mjs bandada.media.asset.flagged.v1 '{"mediaId":"…","ownerId":"…","maxScore":0.97}'
// Sin --id se genera un id nuevo; repetir el mismo --id comprueba la idempotencia de los workflows.
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const idIx = args.indexOf('--id');
const id = idIx >= 0 ? args.splice(idIx, 2)[1] : randomUUID();
const [type, dataJson = '{}'] = args;
if (!type) { console.error('uso: publish-event.mjs <type> \'<json data>\' [--id <uuid>]'); process.exit(2); }

const base = process.env.RABBITMQ_MGMT_URL ?? 'http://localhost:15672';
const auth = Buffer.from(`${process.env.RABBITMQ_USER ?? 'admin'}:${process.env.RABBITMQ_PASSWORD ?? 'admin'}`).toString('base64');
const service = type.split('.')[1];
const now = new Date().toISOString();
const data = { occurredAt: now, ...JSON.parse(dataJson) };
const ce = {
  specversion: '1.0', id, source: `/services/${service}-service`, type, time: now,
  datacontenttype: 'application/json', correlationid: `n8n-test-${id.slice(0, 8)}`, data,
};
const res = await fetch(`${base}/api/exchanges/%2F/bandada.events/publish`, {
  method: 'POST',
  headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/json' },
  body: JSON.stringify({
    properties: { content_type: 'application/cloudevents+json', delivery_mode: 2 },
    routing_key: type, payload: JSON.stringify(ce), payload_encoding: 'string',
  }),
});
const out = await res.json().catch(() => ({}));
console.log(`${type} id=${id} routed=${out.routed} (HTTP ${res.status})`);
process.exit(res.ok && out.routed ? 0 : 1);
