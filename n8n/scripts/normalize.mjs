#!/usr/bin/env node
// Normaliza los workflows exportados por `n8n export:workflow --separate` para versionarlos:
// quita campos volátiles, conserva `active` del archivo del repo (o false si es nuevo) y escribe <nombre>.json.
// Uso: node n8n/scripts/normalize.mjs <dir-exportado> [<dir-destino=n8n/workflows>]
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [src, dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'workflows')] = process.argv.slice(2);
if (!src) { console.error('uso: normalize.mjs <dir-exportado> [<dir-destino>]'); process.exit(2); }
const VOLATILE = ['updatedAt', 'createdAt', 'versionId', 'activeVersionId', 'versionCounter', 'triggerCount', 'shared', 'staticData', 'versionMetadata', 'isArchived', 'sourceWorkflowId', 'description', 'meta', 'nodeGroups'];
const activeById = new Map(readdirSync(dest).filter((f) => f.endsWith('.json')).map((f) => { const w = JSON.parse(readFileSync(join(dest, f), 'utf8')); return [w.id, w.active]; }));
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;

for (const f of readdirSync(src).filter((x) => x.endsWith('.json'))) {
  const w = JSON.parse(readFileSync(join(src, f), 'utf8'));
  for (const k of VOLATILE) delete w[k];
  w.active = activeById.get(w.id) ?? false;
  const slug = w.name.replace(/[^A-Za-z0-9._-]+/g, '-');
  writeFileSync(join(dest, `${slug}.json`), JSON.stringify(sortKeys(w), null, 2) + '\n');
  console.log(`${f} -> ${slug}.json`);
}
