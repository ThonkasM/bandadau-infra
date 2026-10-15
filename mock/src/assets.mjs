// Imágenes de juguete generadas en memoria (PNG sin dependencias + SVG) y almacén de subidas.
import { crc32, deflateSync } from 'node:zlib';
import { db } from './state.mjs';

const hsl = (h, s, l) => {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
};
function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
  return Buffer.concat([len, t, data, crc]);
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1);
    raw[o] = 0;
    for (let x = 0; x < w; x++) { const [r, g, b] = pixel(x, y); raw[o + 1 + x * 3] = r; raw[o + 2 + x * 3] = g; raw[o + 3 + x * 3] = b; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const rnd = (seed) => { let s = seed * 2654435761 % 4294967296 || 1; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; };

function scene(kind, n) {
  const r = rnd(n * 97 + kind.length * 13);
  const hue = (n * 47 + kind.length * 31) % 360;
  if (kind === 'avatars') {
    const bg = hsl(hue, 0.55, 0.82), fg = hsl(hue, 0.6, 0.4);
    return png(128, 128, (x, y) => {
      const dx = x - 64, dy = y - 50;
      if (dx * dx + dy * dy < 22 * 22) return fg; // cabeza
      const bx = x - 64, by = y - 128;
      if (bx * bx / (46 * 46) + by * by / (48 * 48) < 1) return fg; // hombros
      return bg;
    });
  }
  const [w, h] = kind === 'events' ? [640, 320] : [480, 320];
  const circles = Array.from({ length: 4 }, () => ({ x: r() * w, y: r() * h, rad: 30 + r() * 80, c: hsl((hue + 40 + r() * 60) % 360, 0.7, 0.6) }));
  return png(w, h, (x, y) => {
    if (kind === 'flagged') return ((x + y) >> 4) % 2 ? [200, 70, 70] : [235, 235, 235];
    for (const c of circles) if ((x - c.x) ** 2 + (y - c.y) ** 2 < c.rad ** 2) return c.c;
    const t = (x / w + y / h) / 2;
    return hsl((hue + t * 50) % 360, 0.65, 0.78 - t * 0.25);
  });
}
function svg(kind, n) {
  const hue = (n * 47 + kind.length * 31) % 360;
  const [w, h] = kind === 'avatars' ? [128, 128] : kind === 'events' ? [640, 320] : [480, 320];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 65% 75%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360} 65% 50%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="52%" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(h / 5)}" fill="#fff">${kind} ${n}</text></svg>`;
}

const cache = new Map();
export function registerAssets(app) {
  app.get('/mock-assets/:kind/:file', async (req, reply) => {
    const { kind, file } = req.params;
    const m = /^(\d+)\.(png|svg)$/.exec(file);
    if (kind === 'uploads') {
      const up = db.uploads.get(file);
      if (!up) return reply.code(404).send();
      return reply.header('Cache-Control', 'no-store').type(up.contentType).send(up.buf);
    }
    if (!m || !['avatars', 'posts', 'events', 'flagged'].includes(kind)) return reply.code(404).send();
    const key = `${kind}/${file}`;
    if (!cache.has(key)) cache.set(key, m[2] === 'png' ? scene(kind, Number(m[1])) : svg(kind, Number(m[1])));
    return reply.header('Cache-Control', 'public, max-age=3600').type(m[2] === 'png' ? 'image/png' : 'image/svg+xml').send(cache.get(key));
  });

  // Destino del "PUT prefirmado" (equivalente a MinIO/S3 en el mock).
  app.put('/mock-assets/uploads/:id', async (req, reply) => {
    const m = db.media.get(req.params.id);
    if (!m) return reply.code(404).send();
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? ''));
    db.uploads.set(m.id, { buf, contentType: req.headers['content-type'] ?? m.mimeType });
    return reply.code(200).header('ETag', '"mock"').send();
  });

  app.get('/mock-checkout/:id', async (req, reply) => {
    const t = db.topups.get(req.params.id);
    if (!t) return reply.code(404).send();
    return reply.type('text/html; charset=utf-8').send(`<!doctype html><meta charset="utf-8"><title>Pago simulado</title><body style="font-family:system-ui;max-width:32rem;margin:3rem auto"><h1>Pago simulado</h1><p>Recarga ${t.package} (${t.amountCredits} créditos) — estado: <b>${t.status}</b>.</p><p>Para completar el pago llama a <code>POST /api/v1/wallet/topups/${t.id}/simulate-payment</code> con tu token.</p></body>`);
  });
}
