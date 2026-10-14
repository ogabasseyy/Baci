import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { buildQualitySheet } from './quality-sheet.mjs';
import { setupPilot } from './quality-sheet-fixtures.mjs';

test('rejects tiers whose decoded geometry exceeds encoder rounding', async () => {
  // The schema tolerates claimed height within ±1 of ideal and honest
  // claims record the prediction exactly, so a claim stacked 2px from
  // the decode is a misbound manifest, not resampling rounding.
  const { assertTierDecodedDimensions } = await import(
    './quality-sheet-render.mjs'
  );
  const sharp = (await import('sharp')).default;
  const bytes = await sharp({
    create: { background: '#ffffff', channels: 3, height: 751, width: 384 },
  })
    .png()
    .toBuffer();
  const files = new Map([['tier.avif', bytes]]);
  await assert.rejects(
    () =>
      assertTierDecodedDimensions(
        { height: 749, path: 'tier.avif', width: 384 },
        files,
        'asset-1'
      ),
    /decodes as 384x751 but the manifest claims 384x749/
  );
  await assertTierDecodedDimensions(
    { height: 750, path: 'tier.avif', width: 384 },
    files,
    'asset-1'
  );
  await assert.rejects(
    () => assertTierDecodedDimensions({ path: 'missing.avif' }, files, 'a'),
    /has no verified bytes/
  );
});

test('accepts rotated passthrough tiers against oriented claims', async () => {
  // Passthrough tiers carry the source EXIF bytes while the manifest
  // records oriented axes: a 600x800 orientation-6 source claims
  // 800x600, and raw-axes comparison would misreject it.
  const { assertTierDecodedDimensions } = await import(
    './quality-sheet-render.mjs'
  );
  const { dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  const bytes = await readFile(join(here, 'fixtures', 'exif-rotated-600x800.jpg'));
  const files = new Map([['tier.jpg', bytes]]);
  await assertTierDecodedDimensions(
    { height: 600, path: 'tier.jpg', width: 800 },
    files,
    'asset-1'
  );
  await assert.rejects(
    () =>
      assertTierDecodedDimensions(
        { height: 800, path: 'tier.jpg', width: 600 },
        files,
        'asset-1'
      ),
    /decodes as 800x600 but the manifest claims 600x800/
  );
});

test('escapes inventory dimension metadata in captions', async () => {
  const { inputRoot, inventoryPath, outputRoot } = await setupPilot();
  const [record] = JSON.parse(await readFile(inventoryPath, 'utf8'));
  const metaPath = join(inputRoot, 'inventory-meta.json');
  await writeFile(
    metaPath,
    JSON.stringify([{ ...record, height: 48, width: '48<x' }])
  );
  const html = await buildQualitySheet({
    inputRoot,
    inventoryPath: metaPath,
    outputRoot,
    slots: { 'header-logo': { cssWidth: 40 } },
  });
  assert.doesNotMatch(html, /48<x/);
  assert.match(html, /48&lt;x/);
});
