// Código de verificación de email desde la API de Mailpit (http://localhost:8025/api/v1).
import { cfg } from './env.mjs';
import { request, poll } from './http.mjs';

async function messagesTo(email) {
  const r = await request('GET', `${cfg.mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=20`);
  return r.ok ? (r.json?.messages ?? []) : [];
}

/**
 * Espera un correo para `email` recibido después de `sinceMs` y devuelve el código de 6 dígitos del más reciente.
 * Devuelve null si no llega.
 */
export async function waitForVerificationCode(email, { sinceMs = 0, timeoutMs = 20000 } = {}) {
  return poll(async () => {
    const msgs = (await messagesTo(email))
      .filter((m) => new Date(m.Created).getTime() >= sinceMs - 2000)
      .sort((a, b) => new Date(b.Created) - new Date(a.Created));
    for (const m of msgs) {
      const detail = await request('GET', `${cfg.mailpit}/api/v1/message/${m.ID}`);
      const body = `${detail.json?.Subject ?? ''}\n${detail.json?.Text ?? ''}\n${detail.json?.HTML ?? ''}\n${m.Snippet ?? ''}`;
      const code = body.match(/(?<![0-9])([0-9]{6})(?![0-9])/);
      if (code) return code[1];
    }
    return null;
  }, { timeoutMs, intervalMs: 1000 });
}

export async function mailpitAvailable() {
  const r = await request('GET', `${cfg.mailpit}/api/v1/info`, { timeoutMs: 5000 });
  return r.ok;
}
