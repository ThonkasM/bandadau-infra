import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ACCESS_TTL, JWT_SECRET } from './config.mjs';

export const now = () => new Date().toISOString();
export const uuid = () => randomUUID();
export const nowMs = () => Date.now();
export const iso = (ms) => new Date(ms).toISOString();
/** UUID determinista y válido (formato v7) para los datos semilla. */
export const fid = (ns, n) =>
  `0192a3b0-${ns.toString(16).padStart(4, '0')}-7000-8000-${n.toString(16).padStart(12, '0')}`;

export const tail = (id) => parseInt(id.slice(-12), 16);
export const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const sha256b64url = (s) => createHash('sha256').update(s).digest('base64url');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const hmacHex = (secret, data) => createHmac('sha256', secret).update(data).digest('hex');

// ---------- JWT de juguete (HS256) ----------
export function signJwt(claims, ttl = ACCESS_TTL) {
  const iat = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'mock-hs256' }));
  const body = b64url(JSON.stringify({ iss: 'bandada-mock', aud: 'bandada', iat, exp: iat + ttl, ...claims }));
  const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
export function verifyJwt(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const expected = createHmac('sha256', JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

// ---------- paginación por cursor (keyset) ----------
// `key(item)` devuelve una cadena ordenable; el cursor es la clave del último elemento devuelto.
export function paginate(items, { cursor, limit }, key, order = 'desc') {
  const sorted = [...items].sort((a, b) => {
    const ka = key(a), kb = key(b);
    return order === 'desc' ? (ka < kb ? 1 : ka > kb ? -1 : 0) : ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  let start = 0;
  if (cursor) {
    const ck = Buffer.from(cursor, 'base64url').toString();
    start = sorted.findIndex((i) => (order === 'desc' ? key(i) < ck : key(i) > ck));
    if (start < 0) start = sorted.length;
  }
  const slice = sorted.slice(start, start + limit);
  const hasMore = start + limit < sorted.length;
  return {
    items: slice,
    nextCursor: hasMore && slice.length ? Buffer.from(key(slice[slice.length - 1])).toString('base64url') : null,
  };
}
export const tsKey = (createdAt, id) => `${String(Date.parse(createdAt)).padStart(15, '0')}:${id}`;

export const parseHashtags = (text) =>
  [...new Set([...text.matchAll(/#([\p{L}\p{N}_]{2,30})/gu)].map((m) => m[1].toLowerCase()))];

/** Respuesta con estado/cabeceras explícitos. */
export const res = (status, body, headers = {}) => ({ __res: true, status, body, headers });
