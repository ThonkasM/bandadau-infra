// Operaciones de identity-service usadas por seed y smoke (REST público + /internal con token de servicio).
import { cfg } from './env.mjs';
import { request, problem } from './http.mjs';
import { stableUuid } from './ids.mjs';
import { waitForVerificationCode } from './mailpit.mjs';

// ID de "actor" que se envía en X-Actor-Id (obligatorio en /internal/v1): usuario técnico del seed.
export const SEED_ACTOR_ID = '00000000-0000-7000-8000-00000000005e';

let cachedServiceToken = null;
export async function serviceToken() {
  if (cachedServiceToken && cachedServiceToken.exp > Date.now() + 30000) return cachedServiceToken.value;
  const r = await request('POST', `${cfg.identityInternal}/api/v1/auth/service-token`, {
    body: {
      clientId: cfg.seedClientId,
      clientSecret: cfg.seedClientSecret,
      scopes: ['users:read', 'users:write', 'universities:write'],
    },
  });
  if (!r.ok) throw new Error(`service-token: ${problem(r)} (¿SERVICE_CLIENTS incluye ${cfg.seedClientId}?)`);
  cachedServiceToken = { value: r.json.accessToken, exp: Date.now() + (r.json.expiresIn ?? 300) * 1000 };
  return cachedServiceToken.value;
}

async function internal(method, path, body) {
  const token = await serviceToken();
  return request(method, `${cfg.identityInternal}${path}`, { token, body, headers: { 'X-Actor-Id': SEED_ACTOR_ID } });
}

export async function listUniversities() {
  const out = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const r = await request('GET', `${cfg.api}/universities?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (!r.ok) throw new Error(`GET /universities: ${problem(r)}`);
    out.push(...(r.json.items ?? []));
    cursor = r.json.nextCursor;
    if (!cursor) break;
  }
  return out;
}

export async function ensureUniversity({ name, domain }) {
  const find = async () => (await listUniversities()).find((u) => u.allowedDomains?.includes(domain));
  let uni = await find();
  if (uni) return { university: uni, created: false };
  const r = await internal('POST', '/internal/v1/universities', { name, allowedDomains: [domain] });
  if (r.status === 201 || r.status === 200) return { university: r.json, created: true };
  uni = await find(); // carrera: otro proceso la creó (409 UNIVERSITY_DOMAIN_TAKEN)
  if (uni) return { university: uni, created: false };
  throw new Error(`crear universidad ${name}: ${problem(r)}`);
}

export const login = (email, password) => request('POST', `${cfg.api}/auth/login`, { body: { email, password } });

/**
 * Deja un usuario ACTIVE y devuelve { tokens, user, created }. Idempotente: si ya existe, solo inicia sesión.
 * Lee el código de verificación desde Mailpit.
 */
export async function ensureUser({ email, password, universityId, locale = 'es' }) {
  const first = await login(email, password);
  if (first.ok) return { tokens: first.json, user: first.json.user, created: false };

  const startedAt = Date.now();
  const reg = await request('POST', `${cfg.api}/auth/register`, {
    idempotencyKey: stableUuid(`register:${email}`),
    body: { email, password, universityId, locale },
  });
  if (reg.status === 409 || reg.status === 422) {
    // ya registrado pero sin verificar (o clave de idempotencia vencida): pide un código nuevo
    const rs = await request('POST', `${cfg.api}/auth/resend-code`, { body: { email } });
    if (!rs.ok && rs.status !== 202 && rs.status !== 204) throw new Error(`resend-code ${email}: ${problem(rs)}`);
  } else if (reg.status !== 201 && reg.status !== 200) {
    throw new Error(`register ${email}: ${problem(reg)}`);
  }

  const code = await waitForVerificationCode(email, { sinceMs: startedAt });
  if (!code) throw new Error(`no llegó el código de verificación de ${email} a Mailpit (${cfg.mailpit}). ¿SMTP_HOST=mailpit en identity?`);
  const ver = await request('POST', `${cfg.api}/auth/verify-email`, { body: { email, code } });
  if (!ver.ok) throw new Error(`verify-email ${email}: ${problem(ver)}`);
  return { tokens: ver.json, user: ver.json.user, created: true };
}

/** Reemplaza los roles (idempotente). Devuelve true si cambió algo. */
export async function ensureRoles(user, roles) {
  const current = [...(user.roles ?? [])].sort().join(',');
  if (current === [...roles].sort().join(',')) return false;
  const r = await internal('PATCH', `/internal/v1/users/${user.id}/roles`, { roles });
  if (!r.ok) throw new Error(`roles de ${user.email}: ${problem(r)}`);
  return true;
}
