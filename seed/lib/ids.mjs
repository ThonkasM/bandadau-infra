import { createHash, randomBytes } from 'node:crypto';

const hex = (b) => b.toString('hex');
const fmt = (h) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;

/** UUIDv7 (ms de tiempo + aleatorio). */
export function uuidv7() {
  const b = randomBytes(16);
  const ts = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  return fmt(hex(b));
}

/** UUID con forma v7 pero DETERMINISTA a partir de un texto (claves de idempotencia / clientId estables entre ejecuciones). */
export function stableUuid(text) {
  const b = createHash('sha256').update(text).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  return fmt(hex(b));
}
