// Genera PNG de demo (degradado diagonal + círculos) sin dependencias. Determinista por semilla.
import { crc32, deflateSync } from 'node:zlib';

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

/** @param {{w?:number,h?:number,from:[number,number,number],to:[number,number,number],dots?:number,seed?:number}} o */
export function demoPng({ w = 640, h = 800, from, to, dots = 5, seed = 1 }) {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const circles = Array.from({ length: dots }, () => ({ x: rnd() * w, y: rnd() * h, r: 40 + rnd() * 120 }));
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      let rgb = [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)];
      for (const c of circles) {
        if ((x - c.x) ** 2 + (y - c.y) ** 2 < c.r ** 2) rgb = rgb.map((v) => Math.min(255, v + 28));
      }
      raw.set(rgb, row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
