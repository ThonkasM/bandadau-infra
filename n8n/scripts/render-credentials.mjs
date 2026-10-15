// Renderiza credentials/*.json.tpl con variables de entorno y escribe un único array JSON
// (formato de `n8n import:credentials`). Uso: node render-credentials.mjs <dir-plantillas> <salida.json>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, out] = process.argv.slice(2);
const defaults = { RABBITMQ_HOST: 'rabbitmq', RABBITMQ_PORT: '5672', RABBITMQ_N8N_USER: 'n8n', SMTP_HOST: 'mailpit', SMTP_PORT: '1025', SMTP_USER: '', SMTP_PASSWORD: '' };
const creds = readdirSync(dir).filter((f) => f.endsWith('.json.tpl')).sort().map((f) => {
  const text = readFileSync(join(dir, f), 'utf8').replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => {
    const v = process.env[k] ?? defaults[k];
    if (v === undefined) throw new Error(`${f}: falta la variable ${k}`);
    return v.replace(/["\\]/g, '\\$&');
  });
  return JSON.parse(text);
});
writeFileSync(out, JSON.stringify(creds), { mode: 0o600 });
console.log(`credenciales renderizadas: ${creds.map((c) => c.id).join(', ')}`);
