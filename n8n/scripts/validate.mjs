#!/usr/bin/env node
// Validación para CI: JSON válido, ids únicos, sin secretos/credenciales reales, disparadores y referencias coherentes.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = (m) => errors.push(m);
const wfs = readdirSync(join(root, 'workflows')).filter((f) => f.endsWith('.json')).map((f) => {
  try { return { f, w: JSON.parse(readFileSync(join(root, 'workflows', f), 'utf8')) }; } catch (e) { fail(`${f}: JSON inválido (${e.message})`); return null; }
}).filter(Boolean);

const ids = new Set(wfs.map(({ w }) => w.id));
if (ids.size !== wfs.length) fail('ids de workflow duplicados');
const credIds = new Set(JSON.parse('[' + readdirSync(join(root, 'credentials')).filter((f) => f.endsWith('.tpl')).map((f) => readFileSync(join(root, 'credentials', f), 'utf8').replace(/\$\{[A-Z0-9_]+\}/g, '0')).join(',') + ']').map((c) => c.id));
const secretRe = /(eyJ[A-Za-z0-9_-]{20,}\.|sk-[A-Za-z0-9]{20,}|bot\d{6,}:[A-Za-z0-9_-]{20,}|"password"\s*:\s*"[^"$=]+")/;
const routerTypes = ['bandada.identity.user.registered.v1', 'bandada.media.asset.flagged.v1', 'bandada.insights.alert.raised.v1', 'bandada.events.event.published.v1'];

for (const { f, w } of wfs) {
  const text = JSON.stringify(w);
  if (secretRe.test(text)) fail(`${f}: posible secreto embebido`);
  const names = new Set(w.nodes.map((n) => n.name));
  if (names.size !== w.nodes.length) fail(`${f}: nombres de nodo duplicados`);
  for (const [from, c] of Object.entries(w.connections)) {
    if (!names.has(from)) fail(`${f}: conexión desde nodo inexistente ${from}`);
    for (const out of c.main) for (const t of out) if (!names.has(t.node)) fail(`${f}: conexión hacia nodo inexistente ${t.node}`);
  }
  for (const n of w.nodes) {
    for (const [type, ref] of Object.entries(n.credentials ?? {})) if (!credIds.has(ref.id)) fail(`${f}/${n.name}: credencial ${type}:${ref.id} sin plantilla en credentials/`);
    if (n.type === 'n8n-nodes-base.executeWorkflow' && !ids.has(n.parameters.workflowId?.value)) fail(`${f}/${n.name}: subworkflow inexistente`);
  }
  if (w.settings?.errorWorkflow && !ids.has(w.settings.errorWorkflow)) fail(`${f}: errorWorkflow inexistente`);
  if (w.name !== 'wf-99-error-handler' && !w.settings?.errorWorkflow) fail(`${f}: sin errorWorkflow`);
}
const router = wfs.find(({ w }) => w.name === 'wf-00-router')?.w;
if (!router) fail('falta wf-00-router');
else {
  const triggers = wfs.filter(({ w }) => w.nodes.some((n) => n.type === 'n8n-nodes-base.rabbitmqTrigger'));
  if (triggers.length !== 1) fail('debe haber exactamente un workflow con RabbitMQ Trigger (D15)');
  const trig = router.nodes.find((n) => n.type === 'n8n-nodes-base.rabbitmqTrigger');
  if (trig?.parameters.queue !== 'n8n.automation') fail('el router debe consumir n8n.automation');
  const text = JSON.stringify(router);
  for (const t of routerTypes) if (!text.includes(t)) fail(`router no despacha ${t}`);
}
for (const name of ['wf-02-recordatorio-evento', 'wf-04-resumen-semanal']) {
  const w = wfs.find((x) => x.w.name === name)?.w;
  if (!w?.nodes.some((n) => n.type === 'n8n-nodes-base.scheduleTrigger')) fail(`${name} necesita Schedule Trigger`);
}
if (errors.length) { console.error(errors.map((e) => `ERROR ${e}`).join('\n')); process.exit(1); }
console.log(`n8n: ${wfs.length} workflows válidos`);
