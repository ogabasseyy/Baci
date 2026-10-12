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

test('embeds the validated tier bytes, never a later reread', async () => {
  const { syncBuiltinESMExports } = await import('node:module');
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
  // instead of readFile calls. Exactly one open plus genuine embedded
  // bytes proves the sheet renders the validated read, never a reread.
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
    assert.equal(
      html.includes(
        `data:${tier.contentType};base64,${genuine.toString('base64')}`
      ),
      true
    );
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

test('derives the original MIME from verified bytes, not the inventory label', async () => {
  const { inputRoot, inventoryPath, outputRoot } = await setupPilot();
  const [record] = JSON.parse(await readFile(inventoryPath, 'utf8'));
  // The record label is unvalidated metadata: a stale-but-allowlisted
  // value (PNG bytes marked JPEG), a missing one, and a markup-breaking
  // one must all render the verified PNG MIME instead of the label.
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
  // not its format or byte count, so only a snapshot decode catches
  // the lie. Each flip stays parse-clean (bytes flip down under the
  // over-source tiers) so the decode check — not the schema — fires.
  // (Dims need no case: ladder width/aspect bindings reject any dims
  // lie at parse time, proven while writing this test.)
  for (const [label, patch, pattern] of [
    [
      'format',
      { format: 'jpeg' },
      /decodes as png but the manifest claims jpeg/,
    ],
    ['bytes', { bytes: 84 }, /is 85 bytes but the manifest claims 84/],
  ]) {
    await writeFile(
      manifestPath,
      JSON.stringify({
        ...manifest,
        source: { ...manifest.source, ...patch },
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
