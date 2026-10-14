// Cliente HTTP mínimo sobre fetch nativo.
export async function request(method, url, { token, body, headers = {}, idempotencyKey, timeoutMs = 20000, locale = 'es' } = {}) {
  const h = { Accept: 'application/json, application/problem+json', 'Accept-Language': locale, ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { status: 0, ok: false, headers: new Headers(), json: null, text: String(e?.cause?.code ?? e?.message ?? e), error: e };
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* no JSON */ }
  return { status: res.status, ok: res.ok, headers: res.headers, json, text };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Reintenta fn() hasta que devuelva un valor "truthy" o venza el plazo. Devuelve el último valor. */
export async function poll(fn, { timeoutMs = 30000, intervalMs = 1000 } = {}) {
  const end = Date.now() + timeoutMs;
  let last;
  while (true) {
    last = await fn();
    if (last) return last;
    if (Date.now() >= end) return last;
    await sleep(intervalMs);
  }
}

/** Espera a que una URL responda con status < 500 (el servicio está arriba). */
export async function waitForUrl(url, { timeoutMs = 120000, ok = (s) => s > 0 && s < 500 } = {}) {
  const r = await poll(async () => ok((await request('GET', url, { timeoutMs: 5000 })).status), { timeoutMs, intervalMs: 2000 });
  return Boolean(r);
}

export function problem(res) {
  const j = res.json;
  const code = j?.code ?? j?.extensions?.code ?? '';
  return `HTTP ${res.status}${code ? ` ${code}` : ''}${j?.detail ? ` — ${j.detail}` : res.text && !j ? ` — ${res.text.slice(0, 160)}` : ''}`;
}
