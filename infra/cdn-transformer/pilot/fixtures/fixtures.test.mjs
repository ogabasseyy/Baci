import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));

async function loadManifest() {
  return JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8'));
}

test('fixture bytes match the pinned manifest', async () => {
  const manifest = await loadManifest();
  assert.ok(manifest.fixtures.length >= 12);
  for (const entry of manifest.fixtures) {
    const bytes = await readFile(join(here, entry.name));
    assert.equal(bytes.length, entry.bytes, entry.name);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      entry.sha256,
      entry.name
    );
  }
});

test('fixtures expose the decode properties tests rely on', async () => {
  const meta = async (name) =>
    sharp(await readFile(join(here, name))).metadata();

  const animatedWebp = await meta('anim-2frame.webp');
  assert.equal(animatedWebp.format, 'webp');
  assert.equal(animatedWebp.pages, 2);

  const animatedGif = await meta('anim-2frame.gif');
  assert.equal(animatedGif.format, 'gif');
  assert.equal(animatedGif.pages, 2);

  const cmyk = await meta('cmyk-400x400.jpg');
  assert.equal(cmyk.space, 'cmyk');
  assert.equal(cmyk.channels, 4);

  const exif = await meta('exif-rotated-600x800.jpg');
  assert.equal(exif.orientation, 6);
  assert.equal(exif.width, 600);
  assert.equal(exif.height, 800);

  const alpha = await meta('alpha-512x512.png');
  assert.equal(alpha.hasAlpha, true);

  const svg = await meta('vector-image.svg');
  assert.equal(svg.format, 'svg');

  await assert.rejects(async () =>
    sharp(await readFile(join(here, 'garbage-not-an-image.bin'))).metadata()
  );
});
