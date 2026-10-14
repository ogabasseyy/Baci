import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs, { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { buildQualitySheet } from './quality-sheet.mjs';
import { setupPilot } from './quality-sheet-fixtures.mjs';

test('requires recorded slot geometry and verified bytes', async () => {
  const { inputRoot, inventoryPath, outputRoot } = await setupPilot();
  await assert.rejects(
    () =>
      buildQualitySheet({ inputRoot, inventoryPath, outputRoot, slots: {} }),
    /slot geometry/
  );
  // Tamper with a committed output: the sheet refuses to render bad bytes.
  const { readdir } = await import('node:fs/promises');
  const generations = await readdir(join(outputRoot, 'generations'));
  const manifest = JSON.parse(
    await readFile(
      join(outputRoot, 'generations', generations[0], 'manifest.json'),
      'utf8'
    )
  );
  await writeFile(
    join(outputRoot, 'generations', generations[0], manifest.tiers[0].path),
    Buffer.from('tampered-bytes!!')
  );
  await assert.rejects(
    () =>
      buildQualitySheet({
        inputRoot,
        inventoryPath,
        outputRoot,
        slots: { 'header-logo': { cssWidth: 40 } },
      }),
    /corrupt|hash|byte size/
  );
});

test('resamples rasters from the validated read, never a reread', async () => {
  const { syncBuiltinESMExports } = await import('node:module');
  const { default: sharp } = await import('sharp');
  const { inputRoot, inventoryPath, outputRoot } = await setupPilot();
  const [generationId] = await fs.readdir(join(outputRoot, 'generations'));
  const manifest = JSON.parse(
    await readFile(
      join(outputRoot, 'generations', generationId, 'manifest.json'),
      'utf8'
    )
  );
  const tier = manifest.tiers[0];
  const target = join(outputRoot, 'generations', generationId, tier.path);
  const genuine = await readFile(target);
  const replacement = Buffer.from(genuine);
  replacement[replacement.length - 1] ^= 1;
  assert.equal(replacement.length, genuine.length);
  assert.notEqual(
    createHash('sha256').update(replacement).digest('hex'),
    tier.sha256
  );
  // Controlled read seam: tier bytes flow through the bounded
  // open/read path (readUpToBytes), so the seam counts opens of the tier
  // instead of readFile calls. Exactly one open plus an embedded raster
  // resampled from the genuine bytes proves the sheet renders the
  // validated read, never a reread — and raw tier bytes are never
  // embedded at all.
  const realOpen = fs.open;
  let opens = 0;
  fs.open = (...args) => {
    if (String(args[0]) === target) {
      opens += 1;
    }
    return realOpen(...args);
  };
  syncBuiltinESMExports();
  try {
    const html = await buildQualitySheet({
      inputRoot,
      inventoryPath,
      outputRoot,
      slots: { 'header-logo': { cssWidth: 40 } },
    });
    assert.equal(opens, 1);
    const expected = await sharp(genuine).resize({ width: 40 }).png().toBuffer();
    assert.equal(
      html.includes(`data:image/png;base64,${expected.toString('base64')}`),
      true
    );
    assert.equal(html.includes(genuine.toString('base64')), false);
    assert.equal(html.includes(replacement.toString('base64')), false);
  } finally {
    fs.open = realOpen;
    syncBuiltinESMExports();
  }
});

test('rejects oversized and malformed inventories before rendering', async () => {
  const { inputRoot, inventoryPath, outputRoot } = await setupPilot();
  const [record] = JSON.parse(await readFile(inventoryPath, 'utf8'));
  // 21 records breach the 20-job cap even when every record is valid.
  const many = Array.from({ length: 21 }, (_, index) => ({
    ...record,
    assetId: `tiny-${index}`,
    slot: `slot-${index}`,
  }));
  const manyPath = join(inputRoot, 'inventory-many.json');
  await writeFile(manyPath, JSON.stringify(many));
  await assert.rejects(
    () =>
      buildQualitySheet({
        inputRoot,
        inventoryPath: manyPath,
        outputRoot,
        slots: { 'header-logo': { cssWidth: 40 } },
      }),
    /at most 20 jobs/
  );
  // Malformed records fail closed instead of rendering a partial sheet.
  const badPath = join(inputRoot, 'inventory-bad.json');
  await writeFile(badPath, JSON.stringify([{ ...record, sha256: 'nope' }]));
  await assert.rejects(
    () =>
      buildQualitySheet({
        inputRoot,
        inventoryPath: badPath,
        outputRoot,
        slots: { 'header-logo': { cssWidth: 40 } },
      }),
    /invalid inventory/
  );
});

test('embeds uniform PNG rasters regardless of inventory labels', async () => {
  const { inputRoot, inventoryPath, outputRoot } = await setupPilot();
  const [record] = JSON.parse(await readFile(inventoryPath, 'utf8'));
  // The record label is unvalidated metadata: a stale-but-allowlisted
  // value (PNG bytes marked JPEG), a missing one, and a markup-breaking
  // one must all render uniform PNG inspection rasters — the label can
  // never leak into a data-URI MIME or the markup.
  for (const contentType of [
    'image/jpeg',
    undefined,
    'image/png";base64,xxx" onerror="alert(1)',
  ]) {
    const labeled = { ...record };
    if (contentType === undefined) {
      delete labeled.contentType;
    } else {
      labeled.contentType = contentType;
    }
    const labeledPath = join(
      inputRoot,
      `inventory-labeled-${String(contentType).length}.json`
    );
    await writeFile(labeledPath, JSON.stringify([labeled]));
    const html = await buildQualitySheet({
      inputRoot,
      inventoryPath: labeledPath,
      outputRoot,
      slots: { 'header-logo': { cssWidth: 40 } },
    });
    assert.match(html, /data:image\/png;base64,/);
    assert.doesNotMatch(html, /data:image\/jpeg;base64,/);
    assert.doesNotMatch(html, /onerror/);
  }
});

test('rejects a stored manifest mislabeling the snapshot source', async () => {
  const { inputRoot, inventoryPath, outputRoot } = await setupPilot();
  const { readdir } = await import('node:fs/promises');
  const [generationId] = await readdir(join(outputRoot, 'generations'));
  const manifestPath = join(
    outputRoot,
    'generations',
    generationId,
    'manifest.json'
  );
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  // Schema-valid flips: the generation id covers the source hash but
  // not its format, byte count, or dimensions, so only a snapshot
  // decode catches the lie. Each flip stays parse-clean (bytes flip
  // down under the over-source tiers; dims flip source and tiers
  // together, since the schema binds tiers relative to the source
  // claims) so the decode check — not the schema — fires.
  for (const [label, sourcePatch, tierPatch, pattern] of [
    [
      'format',
      { format: 'jpeg' },
      null,
      /decodes as png but the manifest claims jpeg/,
    ],
    ['bytes', { bytes: 84 }, null, /is 85 bytes but the manifest claims 84/],
    [
      'dims',
      { orientedHeight: 1, orientedWidth: 1 },
      { actualWidth: 1, height: 1, width: 1 },
      /decodes as \d+x\d+ but the manifest claims 1x1/,
    ],
  ]) {
    await writeFile(
      manifestPath,
      JSON.stringify({
        ...manifest,
        source: { ...manifest.source, ...sourcePatch },
        tiers: tierPatch
          ? manifest.tiers.map((tier) => ({ ...tier, ...tierPatch }))
          : manifest.tiers,
      })
    );
    await assert.rejects(
      () =>
        buildQualitySheet({
          inputRoot,
          inventoryPath,
          outputRoot,
          slots: { 'header-logo': { cssWidth: 40 } },
        }),
      pattern,
      label
    );
  }
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
