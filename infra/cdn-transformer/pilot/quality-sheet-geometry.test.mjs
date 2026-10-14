import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { desiredInspectionWidth } from './quality-sheet-inspect.mjs';
import { buildQualitySheet } from './quality-sheet.mjs';
import { setupPilot } from './quality-sheet-fixtures.mjs';

test('desiredInspectionWidth boosts cover crops by the visible fraction', () => {
  const cover11 = { aspectRatio: '1 / 1', boxAspect: 1, fit: 'cover' };
  // The finding's case: a 4:1 logo in the 1:1 header box shows 1/4
  // of its width, so the raster needs 4x the CSS*dpr width for the
  // visible crop to carry full density.
  assert.equal(desiredInspectionWidth(40, 1, 160, 40, cover11), 160);
  assert.equal(desiredInspectionWidth(40, 2, 160, 40, cover11), 320);
  // Matched aspects need no boost.
  assert.equal(desiredInspectionWidth(40, 1, 48, 48, cover11), 40);
  // Tall sources in square boxes: CSS crops the height, the width is
  // already exact.
  assert.equal(desiredInspectionWidth(40, 1, 40, 160, cover11), 40);
  // 16:9 product card with a 4:3 source: fraction (16/9)/(4/3) > 1
  // clamps to 1 — the width fits, the height crops.
  const cover169 = { aspectRatio: '16 / 9', boxAspect: 16 / 9, fit: 'cover' };
  assert.equal(desiredInspectionWidth(384, 1, 400, 300, cover169), 384);
  // Contain mounts and intrinsic renders show the whole frame.
  const contain = { aspectRatio: '1 / 1', boxAspect: 1, fit: 'contain' };
  assert.equal(desiredInspectionWidth(40, 1, 160, 40, contain), 40);
  assert.equal(desiredInspectionWidth(40, 1, 160, 40, null), 40);
  // Degenerate inputs fail soft to the base width, never NaN.
  assert.equal(desiredInspectionWidth(40, 1, 160, 0, cover11), 40);
  assert.equal(desiredInspectionWidth(40, 1, 0, 40, cover11), 40);
});

test('cover mounts inspect the visible crop at full density', async () => {
  // End to end: the 4:1 wide fixture in the header-logo 1:1 cover
  // mount must rasterize at 160px for the DPR-1 row (not the 40px
  // the pre-boost sizing produced, which CSS would enlarge 4x).
  const { inputRoot, inventoryPath, outputRoot } = await setupPilot(
    { fixture: 'wide-2000x500.png', height: 500, width: 2000 },
    'header-logo'
  );
  const html = await buildQualitySheet({
    inputRoot,
    inventoryPath,
    outputRoot,
    slots: { 'header-logo': { cssWidth: 40 } },
  });
  assert.match(html, /160px inspection raster/);
});

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
