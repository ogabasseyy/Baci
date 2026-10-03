import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs, { copyFile, cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentRecipeId } from './generation-identity.mjs';
import { buildQualitySheet } from './quality-sheet.mjs';
import { runPilotGeneration } from './generate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', name);
const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

async function setupPilot(source = { fixture: 'tiny-48x48.png', height: 48, width: 48 }) {
  const base = join(tmpdir(), `pilot-sheet-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const inputRoot = join(base, 'input');
  const outputRoot = join(base, 'output');
  await mkdir(inputRoot, { recursive: true });
  await copyFile(fixture(source.fixture), join(inputRoot, 'tiny-a.png'));
  const bytes = await readFile(join(inputRoot, 'tiny-a.png'));
  const record = {
    assetId: 'tiny-a',
    capturedAt: '2026-10-01T20:00:00.000Z',
    contentType: 'image/png',
    height: source.height,
    merchantId: MERCHANT,
    role: 'logo',
    schemaVersion: 1,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    slot: 'header-logo',
    sourcePath: 'tiny-a.png',
    url: `https://example.com/tiny-a.png`,
    width: source.width,
  };
  const inventoryPath = join(inputRoot, 'inventory.json');
  await writeFile(inventoryPath, JSON.stringify([record]));
  await runPilotGeneration({ inputRoot, inventoryPath, outputRoot });
  return { base, inputRoot, inventoryPath, outputRoot };
}

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
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /data:image\/avif;base64,/);
  assert.match(html, /data:image\/webp;base64,/);
  assert.match(html, /inspection aid/i);
  assert.match(html, /not.*acceptance/i);
});

test('renders the original at the same capped width as the derivatives', async () => {
  // Full-size tiers (2000px source): the logo ladder tops at 384w, and a
  // 40px slot caps the comparison at 80px — the 384-tier row must not
  // compare a 384px original against 80px derivatives.
  const full = await setupPilot({ fixture: 'wide-2000x500.png', height: 500, width: 2000 });
  const capped = await buildQualitySheet({
    inputRoot: full.inputRoot,
    inventoryPath: full.inventoryPath,
    outputRoot: full.outputRoot,
    slots: { 'header-logo': { cssWidth: 40 } },
  });
  assert.doesNotMatch(capped, /<img src="data:image\/png[^>]*style="width:384px"/);
  assert.match(capped, /<img src="data:image\/png[^>]*style="width:80px"/);
  // A wide slot leaves full rungs uncapped: the 96-tier row compares at
  // the rung's own width on both sides.
  const wide = await buildQualitySheet({
    inputRoot: full.inputRoot,
    inventoryPath: full.inventoryPath,
    outputRoot: full.outputRoot,
    slots: { 'header-logo': { cssWidth: 500 } },
  });
  assert.match(wide, /<img src="data:image\/png[^>]*style="width:96px"/);
  // Narrow sources encode below their request (48px source, 96w rung), so
  // the original follows the encoded width — not the request — there too.
  const narrow = await setupPilot();
  const narrowSheet = await buildQualitySheet({
    inputRoot: narrow.inputRoot,
    inventoryPath: narrow.inventoryPath,
    outputRoot: narrow.outputRoot,
    slots: { 'header-logo': { cssWidth: 500 } },
  });
  assert.match(narrowSheet, /<img src="data:image\/png[^>]*style="width:48px"/);
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
    await readFile(join(outputRoot, 'generations', generationId, 'manifest.json'), 'utf8')
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
  // Controlled read seam: the first read of the tier returns genuine bytes;
  // any reread returns same-length replacement bytes (nothing on disk changes).
  const reads = new Map();
  const realReadFile = fs.readFile;
  fs.readFile = async (...args) => {
    const path = String(args[0]);
    reads.set(path, (reads.get(path) ?? 0) + 1);
    if (path === target && reads.get(path) > 1) {
      return Buffer.from(replacement);
    }
    return realReadFile(...args);
  };
  syncBuiltinESMExports();
  try {
    const html = await buildQualitySheet({
      inputRoot,
      inventoryPath,
      outputRoot,
      slots: { 'header-logo': { cssWidth: 40 } },
    });
    assert.equal(reads.get(target), 1);
    assert.equal(
      html.includes(
        `data:${tier.contentType};base64,${genuine.toString('base64')}`
      ),
      true
    );
    assert.equal(html.includes(replacement.toString('base64')), false);
  } finally {
    fs.readFile = realReadFile;
    syncBuiltinESMExports();
  }
});
