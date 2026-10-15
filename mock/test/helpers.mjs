// Arranca el mock en un puerto libre y ofrece un cliente fetch + validación de respuestas contra el OpenAPI (ajv).
process.env.MOCK_QUEUE_TICK_MS ??= '1500';
process.env.MOCK_LOG = '';
const { buildApp } = await import('../src/app.mjs');
const { compile, deref } = await import('../src/spec.mjs');

export const PASSWORD = 'Bandada#2026';
export const UMSA = '0192a3b0-0001-7000-8000-000000000001';
export const app = await buildApp();
await app.listen({ port: 0, host: '127.0.0.1' });
export const port = app.server.address().port;
export const origin = `http://127.0.0.1:${port}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const stop = () => app.close();

const opsById = new Map(app.mockOps.map((o) => [o.id, o]));
const problemSchema = () => deref({ $ref: './shared/components.yaml#/components/schemas/Problem' }, 'identity-service.yaml');

/** Valida `body` contra el esquema de la respuesta `status` de la operación `opId`. Devuelve [] si es válido. */
export function schemaErrors(opId, status, body) {
  const op = opsById.get(opId);
  if (!op) throw new Error(`operación desconocida ${opId}`);
  let schema = op.responseSchema(String(status));
  if (!schema && status >= 400) schema = problemSchema();
  if (!schema) return []; // sin cuerpo en el contrato
  const validate = compile(schema, `res:${opId}:${status}`);
  return validate(body) ? [] : validate.errors.map((e) => `${e.instancePath} ${e.message}`);
}

export async function call(opId, { token, body, params = {}, query = {}, headers = {}, expect } = {}) {
  const op = opsById.get(opId);
  let url = op.url.replace(/:(\w+)/g, (_, k) => encodeURIComponent(params[k]));
  const qs = new URLSearchParams(query).toString();
  if (qs) url += `?${qs}`;
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(origin + url, { method: op.method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  const out = { status: r.status, body: json, headers: r.headers, schemaErrors: json === undefined ? [] : schemaErrors(opId, r.status, json) };
  if (expect !== undefined && r.status !== expect) throw new Error(`${opId}: esperaba ${expect} y llegó ${r.status}: ${text}`);
  return out;
}

export async function login(email, password = PASSWORD, client = 'native') {
  const r = await call('login', { body: { email, password }, headers: { 'x-bandada-client': client }, expect: 200 });
  return { token: r.body.accessToken, user: r.body.user, res: r };
}
