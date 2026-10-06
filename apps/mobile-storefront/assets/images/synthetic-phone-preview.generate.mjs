// Generates synthetic-phone-preview.png: a dev-only placeholder render for
// the "synthetic phone" fixture goal (see
// components/wallet/get-savings-goal-image-source.ts). The previous 1.4MB
// photorealistic PNG had no recorded source, so this script is the asset's
// provenance: run `node synthetic-phone-preview.generate.mjs` to rebuild it
// byte-identically. Pure Node.js, no dependencies.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const WIDTH = 256;
const HEIGHT = 256;

const BACKGROUND = [243, 244, 246, 255];
const BODY = [17, 24, 39, 255];
const SCREEN = [59, 130, 246, 255];
const CAMERA = [17, 24, 39, 255];

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function inRoundedRect(x, y, left, top, right, bottom, radius) {
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return (
    x >= left &&
    x < right &&
    y >= top &&
    y < bottom &&
    dx * dx + dy * dy <= radius * radius
  );
}

// Phone body with screen and punch-hole camera, centered.
const bodyBounds = { left: 78, top: 28, right: 178, bottom: 228, radius: 18 };
const screenBounds = { left: 88, top: 44, right: 168, bottom: 212, radius: 10 };
const camera = { x: 128, y: 36, r: 5 };

const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    let color = BACKGROUND;
    if (
      inRoundedRect(
        x,
        y,
        bodyBounds.left,
        bodyBounds.top,
        bodyBounds.right,
        bodyBounds.bottom,
        bodyBounds.radius
      )
    ) {
      color = BODY;
    }
    if (
      inRoundedRect(
        x,
        y,
        screenBounds.left,
        screenBounds.top,
        screenBounds.right,
        screenBounds.bottom,
        screenBounds.radius
      )
    ) {
      color = SCREEN;
    }
    const dx = x - camera.x;
    const dy = y - camera.y;
    if (dx * dx + dy * dy <= camera.r * camera.r) {
      color = CAMERA;
    }
    pixels.set(color, (y * WIDTH + x) * 4);
  }
}

const scanlines = Buffer.alloc(HEIGHT * (1 + WIDTH * 4));
for (let y = 0; y < HEIGHT; y += 1) {
  scanlines[y * (1 + WIDTH * 4)] = 0;
  pixels.copy(
    scanlines,
    y * (1 + WIDTH * 4) + 1,
    y * WIDTH * 4,
    (y + 1) * WIDTH * 4
  );
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 6; // color type: RGBA

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(scanlines, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const outPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'synthetic-phone-preview.png'
);
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes)`);
