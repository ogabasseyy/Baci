import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { currentRecipeId } from './generation-identity.mjs';
import { buildQualitySheet, readSlotsGeometry } from './quality-sheet.mjs';
import { setupPilot } from './quality-sheet-fixtures.mjs';
import { buildRungRows, tierCells } from './quality-sheet-render.mjs';

test('rejects an oversized slots file before parsing', async () => {
  const dir = join(
    tmpdir(),
    `pilot-slots-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(dir, { recursive: true });
  const slotsPath = join(dir, 'slots.json');
  // Same operator ceiling as the inventory input: slot geometry is
  // small, so a giant file is corruption, not geometry.
  await writeFile(slotsPath, Buffer.alloc(1024 * 1024 + 1, 120));
  await assert.rejects(() => readSlotsGeometry(slotsPath), /exceeds 1048576/);
  await writeFile(slotsPath, 'not json{');
  await assert.rejects(() => readSlotsGeometry(slotsPath), /not valid JSON/);
  await writeFile(
    slotsPath,
    JSON.stringify({ 'header-logo': { cssWidth: 40 } })
  );
  assert.deepEqual(await readSlotsGeometry(slotsPath), {
    'header-logo': { cssWidth: 40 },
  });
});

test('rejects an oversized inventory before parsing', async () => {
  const { inputRoot, inventoryPath, outputRoot } = await setupPilot();
  // A corrupt or swapped-in giant file rejects on size instead of
  // exhausting the inspection process ahead of the 20-job cap.
  await writeFile(inventoryPath, Buffer.alloc(1024 * 1024 + 1, 120));
  await assert.rejects(
    () =>
      buildQualitySheet({
        inputRoot,
        inventoryPath,
        outputRoot,
        slots: { 'header-logo': { cssWidth: 40 } },
      }),
    /exceeds 1048576/
  );
});

test('builds a side-by-side sheet from verified files', async () => {
  const { inputRoot, inventoryPath, outputRoot } = await setupPilot();
  const html = await buildQualitySheet({
    inputRoot,
    inventoryPath,
    outputRoot,
    slots: { 'header-logo': { cssWidth: 40 } },
  });
  assert.match(html, /tiny-a/);
  assert.match(html, /header-logo/);
  // Inspection rasters are uniform PNG resamples: raw tier bytes are
  // never embedded, so no AVIF/WebP data URIs appear anywhere.
  assert.match(html, /data:image\/png;base64,/);
  assert.doesNotMatch(html, /data:image\/avif;base64,/);
  assert.doesNotMatch(html, /data:image\/webp;base64,/);
  assert.match(html, /inspection aid/i);
  assert.match(html, /not.*acceptance/i);
});

test('renders every DPR row at the slot CSS width', async () => {
  // Full-size tiers (2000px source): the logo ladder tops at 384w, and
  // a 40px slot renders one explicit row per DPR — but EVERY row's
  // displayed box stays at the 40px slot width. DPR changes only the
  // inspection raster's pixel density (40/80/120px), never the box:
  // the 384-tier rows never compare a 384px original, nor a 120px
  // box, against the mounted slot. The hero slot has no canonical
  // mount, so these rows exercise the legacy intrinsic render this
  // test's width assertions target.
  const full = await setupPilot(
    {
      fixture: 'wide-2000x500.png',
      height: 500,
      width: 2000,
    },
    'mobile-hero-slide-0'
  );
  const capped = await buildQualitySheet({
    inputRoot: full.inputRoot,
    inventoryPath: full.inventoryPath,
    outputRoot: full.outputRoot,
    slots: { 'mobile-hero-slide-0': { cssWidth: 40 } },
  });
  assert.doesNotMatch(
    capped,
    /<img src="data:image\/png[^>]*style="width:384px"/
  );
  // No box at a DPR width: every image displays at the slot CSS width.
  assert.doesNotMatch(capped, /style="width:120px/);
  assert.doesNotMatch(capped, /style="width:80px/);
  assert.doesNotMatch(capped, /style="width:96px/);
  assert.match(capped, /<img src="data:image\/png[^>]*style="width:40px"/);
  // Each rung renders all three DPR rows. The caption states the DPR
  // and the raster width carrying that DPR's pixel density: the DPR
  // multiple where encoded pixels reach it, the encoded width
  // otherwise (never upscaled).
  assert.match(capped, /384px tier · DPR 1/);
  assert.match(capped, /384px tier · DPR 2/);
  assert.match(capped, /384px tier · DPR 3/);
  assert.match(capped, /compared at 40px CSS · DPR 1 \(40px inspection raster\)/);
  assert.match(capped, /compared at 40px CSS · DPR 2 \(80px inspection raster\)/);
  assert.match(
    capped,
    /compared at 40px CSS · DPR 3 \(120px inspection raster\)/
  );
  assert.match(
    capped,
    /compared at 40px CSS · DPR 3 \(96px inspection raster · encoded-pixel ceiling\)/
  );
  // A wide slot leaves full rungs uncapped: the 96-tier rows still
  // display at the 500px slot width while their rasters carry the
  // encoded 96px at every DPR.
  const wide = await buildQualitySheet({
    inputRoot: full.inputRoot,
    inventoryPath: full.inventoryPath,
    outputRoot: full.outputRoot,
    slots: { 'mobile-hero-slide-0': { cssWidth: 500 } },
  });
  assert.match(wide, /<img src="data:image\/png[^>]*style="width:500px"/);
  assert.match(
    wide,
    /compared at 500px CSS · DPR 1 \(96px inspection raster · encoded-pixel ceiling\)/
  );
  // Narrow sources encode below their request (48px source, 96w rung),
  // so the rasters follow the encoded width — not the request — there
  // too, while the box stays at the slot width.
  const narrow = await setupPilot(undefined, 'mobile-hero-slide-0');
  const narrowSheet = await buildQualitySheet({
    inputRoot: narrow.inputRoot,
    inventoryPath: narrow.inventoryPath,
    outputRoot: narrow.outputRoot,
    slots: { 'mobile-hero-slide-0': { cssWidth: 500 } },
  });
  assert.match(
    narrowSheet,
    /<img src="data:image\/png[^>]*style="width:500px"/
  );
  assert.match(
    narrowSheet,
    /compared at 500px CSS · DPR 1 \(48px inspection raster · encoded-pixel ceiling\)/
  );
  // Uncropped derivatives render at the slot CSS width like the
  // original — DPR changes raster density, never the displayed box.
  assert.doesNotMatch(capped, /max-width:/);
  assert.match(
    capped,
    /<img src="data:image\/png[^>]*style="width:40px;height:auto"/
  );
});

test('sizes an uncropped wide tier to the slot CSS width', () => {
  // The displayed box is always the slot CSS width: a 2000px tier
  // shows its inspection raster at 96px CSS like the original, with
  // the encoded 2000w kept as caption provenance.
  const cells = tierCells(
    {
      bytes: 10,
      contentType: 'image/avif',
      format: 'avif',
      height: 500,
      path: 'wide.avif',
      quality: 70,
      sha256: 'f'.repeat(64),
      width: 2000,
    },
    { bytes: Buffer.from('raster-bytes'), contentType: 'image/png' },
    null,
    96
  );
  assert.match(cells, /<img[^>]*style="width:96px;height:auto"/);
  assert.match(cells, /data:image\/png;base64,/);
  assert.doesNotMatch(cells, /max-width/);
});

test('labels original-passthrough tiers instead of printing qnull', () => {
  // Passthrough tiers carry quality null (no encode happened): the
  // caption must say so explicitly, not imply a reviewed quality.
  const cells = tierCells(
    {
      bytes: 10,
      contentType: 'image/avif',
      delivery: 'original-passthrough',
      format: 'avif',
      height: 48,
      path: 'pass.avif',
      quality: null,
      sha256: 'e'.repeat(64),
      width: 48,
    },
    { bytes: Buffer.from('raster-bytes'), contentType: 'image/png' },
    null,
    48
  );
  assert.match(cells, /passthrough \(no encode\)/);
  assert.doesNotMatch(cells, /qnull/);
});

test('buildRungRows carries DPR pixel density in same-width boxes', async () => {
  // White-box on the row builder: decode every embedded raster and
  // prove the widths — DPR 1/2/3 rasters at 40/80/120px for a wide
  // rung, all displayed at the 40px slot width.
  const sharp = (await import('sharp')).default;
  const source = await sharp({
    create: { background: '#336699', channels: 3, height: 500, width: 500 },
  })
    .png()
    .toBuffer();
  const tierBytes = await sharp({
    create: { background: '#993366', channels: 3, height: 384, width: 384 },
  })
    .png()
    .toBuffer();
  const tiers = [
    {
      bytes: tierBytes.length,
      contentType: 'image/avif',
      delivery: 'generated',
      format: 'avif',
      height: 384,
      path: 'tier.avif',
      quality: 70,
      requestedWidth: 384,
      sha256: 'f'.repeat(64),
      width: 384,
    },
  ];
  const { embeddedBytes, html } = await buildRungRows({
    crop: null,
    files: new Map([['tier.avif', tierBytes]]),
    geometry: { cssWidth: 40 },
    mountNote: '',
    record: { height: 500, width: 500 },
    requestedWidth: 384,
    snapshotBytes: source,
    tiers,
  });
  // Every image (original plus tier per row) displays at the slot
  // CSS width — originals end the style there, tiers continue with
  // height:auto, so accept either terminator.
  assert.equal(
    [...html.matchAll(/style="width:(\d+)px[;"]/g)]
      .map((m) => m[1])
      .join(','),
    '40,40,40,40,40,40'
  );
  // Original plus one tier per DPR row: six rasters at 40/80/120px.
  const rasters = [...html.matchAll(/data:image\/png;base64,([^"]+)/g)];
  assert.equal(rasters.length, 6);
  const widths = [];
  for (const [, payload] of rasters) {
    const meta = await sharp(Buffer.from(payload, 'base64')).metadata();
    widths.push(meta.width);
  }
  assert.deepEqual(widths, [40, 40, 80, 80, 120, 120]);
  // The reported cost covers every raster occurrence, base64-inflated.
  assert.ok(embeddedBytes > 0);
  assert.equal(
    embeddedBytes,
    rasters.reduce(
      (sum, [, payload]) => sum + 'data:image/png;base64,'.length + payload.length,
      0
    )
  );
});

test('ignores unrelated corrupt generations when locating assets', async () => {
  const { inputRoot, inventoryPath, outputRoot } = await setupPilot();
  const corruptDir = join(outputRoot, 'generations', 'f'.repeat(64));
  await mkdir(corruptDir, { recursive: true });
  await writeFile(join(corruptDir, 'manifest.json'), '{corrupt');
  const html = await buildQualitySheet({
    inputRoot,
    inventoryPath,
    outputRoot,
    slots: { 'header-logo': { cssWidth: 40 } },
  });
  assert.match(html, /tiny-a/);
});

test('refuses to render a stale-recipe generation as current', async () => {
  const { inputRoot, inventoryPath, outputRoot } = await setupPilot();
  const { readdir } = await import('node:fs/promises');
  const generations = await readdir(join(outputRoot, 'generations'));
  const currentDir = join(outputRoot, 'generations', generations[0]);
  const manifestPath = join(currentDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.recipeId = 'recipe/stale-test-only';
  await writeFile(manifestPath, JSON.stringify(manifest));
  // A recipe bump renames the generation directory, so the stale bytes live
  // on after the current recipe has no generation yet.
  await rename(currentDir, join(outputRoot, 'generations', '0'.repeat(64)));
  await assert.rejects(
    () =>
      buildQualitySheet({
        inputRoot,
        inventoryPath,
        outputRoot,
        slots: { 'header-logo': { cssWidth: 40 } },
      }),
    /no verified generation.*current recipe/
  );
});

test('renders current-recipe bytes when stale generations coexist', async () => {
  const { inputRoot, inventoryPath, outputRoot } = await setupPilot();
  const { readdir } = await import('node:fs/promises');
  const generations = await readdir(join(outputRoot, 'generations'));
  const currentDir = join(outputRoot, 'generations', generations[0]);
  const staleDir = join(outputRoot, 'generations', '0'.repeat(64));
  await cp(currentDir, staleDir, { recursive: true });
  const staleManifestPath = join(staleDir, 'manifest.json');
  const staleManifest = JSON.parse(await readFile(staleManifestPath, 'utf8'));
  staleManifest.recipeId = 'recipe/stale-test-only';
  await writeFile(staleManifestPath, JSON.stringify(staleManifest));
  const html = await buildQualitySheet({
    inputRoot,
    inventoryPath,
    outputRoot,
    slots: { 'header-logo': { cssWidth: 40 } },
  });
  assert.match(html, new RegExp(generations[0].slice(0, 16)));
  assert.match(html, new RegExp(currentRecipeId().replaceAll('/', '\\/')));
  assert.doesNotMatch(html, /recipe\/stale-test-only/);
});
