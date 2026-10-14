// Lee ../../.env (con expansión de ${VAR}) y deja que process.env lo sobreescriba. Sin dependencias.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENV_PATH = fileURLToPath(new URL('../../.env', import.meta.url));
const EXAMPLE_PATH = fileURLToPath(new URL('../../.env.example', import.meta.url));

function parse(path) {
  const out = {};
  let text = '';
  try { text = readFileSync(path, 'utf8'); } catch { return out; }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const fromFile = { ...parse(EXAMPLE_PATH), ...parse(ENV_PATH) };
const merged = { ...fromFile, ...process.env };

function expand(value, depth = 0) {
  if (depth > 5) return value;
  return value.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g, (_, k, d) => expand(merged[k] ?? d ?? '', depth + 1));
}

export function env(key, fallback = '') {
  const v = merged[key];
  return v === undefined || v === '' ? fallback : expand(v);
}

const domain = env('BASE_DOMAIN', 'bandada.localhost');
export const cfg = {
  domain,
  api: env('SEED_API_URL', `http://api.${domain}/api/v1`).replace(/\/$/, ''),
  graphql: env('SEED_GRAPHQL_URL', `http://api.${domain}/graphql`),
  // /internal y service-token NO pasan por Traefik (403): se llaman al puerto publicado del servicio.
  identityInternal: env('SEED_IDENTITY_INTERNAL_URL', `http://localhost:${env('IDENTITY_HOST_PORT', '7001')}`).replace(/\/$/, ''),
  mailpit: env('SEED_MAILPIT_URL', `http://localhost:${env('MAILPIT_UI_PORT', '8025')}`).replace(/\/$/, ''),
  password: env('SEED_DEMO_PASSWORD', 'Bandada#2026'),
  seedClientId: 'bandada-seed',
  seedClientSecret: env('SEED_SERVICE_CLIENT_SECRET', 'dev-secret-seed'),
  ticketingPort: env('TICKETING_HOST_PORT', '7006'),
  project: env('COMPOSE_PROJECT', env('COMPOSE_PROJECT_NAME', 'bandada')),
};
