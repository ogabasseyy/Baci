// Deterministic pilot fixture generator. Run from infra/cdn-transformer:
//   node pilot/fixtures/make-fixtures.mjs
// Requires ImageMagick 7 (magick) and node with the workspace sharp install.
// Output bytes are committed; pilot/fixtures/manifest.json pins their hashes
// so accidental regeneration drift fails loudly. Fixture images exercise real
// Sharp decode paths in tests: text legibility, photographic detail, alpha,
// EXIF orientation, CMYK profiles, animation, corruption, and rejection.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

async function magick(args) {
  await run('magick', args);
}

async function sha256Of(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function main() {
  await mkdir(here, { recursive: true });

  // Readable-text fixture: high-contrast caption over a flat brand block.
  await magick([
    '-size', '800x600', 'xc:#1d4ed8',
    '-font', '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '-fill', 'white', '-pointsize', '64', '-gravity', 'center',
    '-annotate', '+0-40', 'Omnimart',
    '-fill', '#fde68a', '-pointsize', '36',
    '-annotate', '+0+80', 'Fresh deals every day',
    '-strip', join(here, 'text-800x600.png'),
  ]);

  // Photographic-detail fixture: seeded plasma plus noise, JPEG encoded.
  await magick([
    '-size', '1254x1254', 'plasma:fractal', '-seed', '27',
    '-attenuate', '0.4', '+noise', 'Gaussian',
    '-quality', '92', '-strip', join(here, 'photo-1254x1254.jpg'),
  ]);

  // Alpha fixture: transparent canvas with an opaque disc and a
  // half-transparent square (exercises alpha preservation, no flattening).
  await magick([
    '-size', '512x512', 'xc:none',
    '-fill', '#dc2626', '-draw', 'circle 170,256 170,96',
    '-fill', 'rgba(37,99,235,0.5)', '-draw', 'rectangle 256,156 456,356',
    '-strip', join(here, 'alpha-512x512.png'),
  ]);

  // EXIF-orientation fixture: stored 600x800, displayed 800x600 (orientation 6).
  const portrait = sharp({
    create: {
      background: { b: 216, g: 180, r: 253 },
      channels: 3,
      height: 800,
      width: 600,
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  await sharp(await portrait)
    .withMetadata({ orientation: 6 })
    .toFile(join(here, 'exif-rotated-600x800.jpg'));

  // CMYK/profiled fixture: must convert to sRGB without silent color shifts.
  await magick([
    '-size', '400x400', 'xc:#0ea5e9',
    '-fill', '#f97316', '-draw', 'roundrectangle 60,60 340,340 40,40',
    '-colorspace', 'CMYK', '-strip', join(here, 'cmyk-400x400.jpg'),
  ]);

  // Animated fixtures: two frames each; must be rejected, never first-framed.
  await magick([
    '-size', '64x64', 'xc:red', 'xc:blue',
    '-set', 'delay', '10', '-loop', '0', '-strip',
    join(here, 'anim-2frame.gif'),
  ]);
  await magick([
    '-size', '64x64', 'xc:red', 'xc:blue',
    '-set', 'delay', '10', '-loop', '0',
    '-define', 'webp:lossless=true', '-strip',
    join(here, 'anim-2frame.webp'),
  ]);

  // Unsupported-format and corruption fixtures.
  await writeFile(
    join(here, 'vector-image.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="red"/></svg>\n'
  );
  const photo = await readFile(join(here, 'photo-1254x1254.jpg'));
  await writeFile(join(here, 'corrupt-truncated.jpg'), photo.subarray(0, 1024));
  await writeFile(
    join(here, 'garbage-not-an-image.bin'),
    Buffer.from('this is definitely not image data'.repeat(8))
  );

  // Tiny source: exercises natural-dimension dedupe (no upscaling).
  await magick([
    '-size', '48x48', 'xc:#16a34a', '-strip', join(here, 'tiny-48x48.png'),
  ]);

  // Wide aspect: exercises aspect preservation without crop.
  await magick([
    '-size', '2000x500', 'gradient:#7c3aed-#06b6d4', '-strip',
    join(here, 'wide-2000x500.png'),
  ]);

  // Still AVIF input: accepted input format (Sharp reports it as `heif`).
  await sharp(await readFile(join(here, 'text-800x600.png')))
    .resize({ width: 256 })
    .avif({ effort: 4, quality: 70 })
    .toFile(join(here, 'still-256x256.avif'));

  const names = [
    'alpha-512x512.png',
    'anim-2frame.gif',
    'anim-2frame.webp',
    'cmyk-400x400.jpg',
    'corrupt-truncated.jpg',
    'exif-rotated-600x800.jpg',
    'garbage-not-an-image.bin',
    'photo-1254x1254.jpg',
    'still-256x256.avif',
    'text-800x600.png',
    'tiny-48x48.png',
    'vector-image.svg',
    'wide-2000x500.png',
  ];
  const manifest = { fixtures: [] };
  for (const name of names) {
    const path = join(here, name);
    const bytes = await readFile(path);
    let meta = null;
    try {
      const info = await sharp(bytes, { limitInputPixels: 268_402_689 }).metadata();
      meta = {
        channels: info.channels ?? null,
        format: info.format ?? null,
        hasAlpha: info.hasAlpha ?? null,
        height: info.height ?? null,
        orientation: info.orientation ?? null,
        pages: info.pages ?? null,
        space: info.space ?? null,
        width: info.width ?? null,
      };
    } catch {
      meta = { unreadable: true };
    }
    manifest.fixtures.push({
      bytes: bytes.length,
      metadata: meta,
      name,
      sha256: await sha256Of(path),
    });
  }
  await writeFile(join(here, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${manifest.fixtures.length} fixtures`);
}

await main();
