// Draws the extension icon (a blue rounded square with a play triangle over code
// lines) as PNGs into public/icon/. Run once with `node scripts/make-icons.mjs`;
// the PNGs are committed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;
const BLUE = [9, 105, 218];
const WHITE = [255, 255, 255];
const PALE = [160, 200, 245];

/** Colour at (x, y) in a 1×1 square, or undefined for transparent. */
function shade(x, y) {
  const r = 0.2;
  const dx = Math.max(r - x, x - (1 - r), 0);
  const dy = Math.max(r - y, y - (1 - r), 0);
  if (dx * dx + dy * dy > r * r) return undefined;
  // Play triangle, pointing right.
  const [ax, ay, bx, by, cx, cy] = [0.4, 0.3, 0.4, 0.7, 0.74, 0.5];
  const sign = (px, py, qx, qy, sx, sy) => (px - sx) * (qy - sy) - (qx - sx) * (py - sy);
  const d1 = sign(x, y, ax, ay, bx, by);
  const d2 = sign(x, y, bx, by, cx, cy);
  const d3 = sign(x, y, cx, cy, ax, ay);
  if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return WHITE;
  // Three short "code lines" on the left.
  for (const [ly, len] of [[0.34, 0.12], [0.5, 0.08], [0.66, 0.12]]) {
    if (Math.abs(y - ly) < 0.035 && x > 0.18 && x < 0.18 + len) return PALE;
  }
  return BLUE;
}

function png(size) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const c = shade((x + (sx + 0.5) / SUPERSAMPLE) / size, (y + (sy + 0.5) / SUPERSAMPLE) / size);
          if (!c) continue;
          sum[0] += c[0];
          sum[1] += c[1];
          sum[2] += c[2];
          sum[3] += 1;
        }
      }
      const n = SUPERSAMPLE * SUPERSAMPLE;
      const o = 1 + x * 4;
      if (sum[3]) {
        row[o] = Math.round(sum[0] / sum[3]);
        row[o + 1] = Math.round(sum[1] / sum[3]);
        row[o + 2] = Math.round(sum[2] / sum[3]);
      }
      row[o + 3] = Math.round((sum[3] / n) * 255);
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

const dir = new URL('../public/icon/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const size of SIZES) writeFileSync(new URL(`${size}.png`, dir), png(size));
console.log(`Wrote ${SIZES.join(', ')} px icons to public/icon/`);
