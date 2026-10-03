import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readFile,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { RECIPE_ID } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import {
  assertManifestContract,
  assertServedAgreement,
  assertServedMountCoverage,
  extractLabPictures,
  extractLabPreloads,
  extractLabSections,
  fetchServedAgreement,
  parsePreflightArgs,
  parseStoreMap,
  runOfflinePreflight,
  runPreflight,
} from './merchant-image-pilot-preflight.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GENERATOR_FIXTURES = join(
  here,
  '..',
  '..',
  '..',
  '..',
  'infra',
  'cdn-transformer',
  'pilot',
  'fixtures'
);
const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const RECIPE = RECIPE_ID;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function setupOfflineAssets(assets) {
  const base = join(
    tmpdir(),
    `pilot-preflight-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const inputRoot = join(base, 'input');
  const outputRoot = join(base, 'output');
  const publicDir = join(base, 'public');
  await mkdir(inputRoot, { recursive: true });
  await mkdir(publicDir, { recursive: true });
  const staged = [];
  for (const asset of assets) {
    const merchantId = asset.merchantId ?? MERCHANT;
    const sourcePath = `${asset.assetId}.png`;
    await copyFile(
      join(GENERATOR_FIXTURES, 'tiny-48x48.png'),
      join(inputRoot, sourcePath)
    );
    const snapshot = await readFile(join(inputRoot, sourcePath));
    const sourceSha = sha256(snapshot);
    const generationDir = join(outputRoot, 'generations', asset.generationId);
    await mkdir(generationDir, { recursive: true });
    // Real encodings on the genuine role ladder so descriptor checks verify
    // actual decoded dimensions, not string shapes.
    const tiers = [];
    for (const width of asset.ladder) {
      for (const format of ['avif', 'webp']) {
        const bytes = await sharp(snapshot)
          .resize(width, width)
          .toFormat(format)
          .toBuffer();
        const hash = sha256(bytes);
        const fileName = `${hash}.${format}`;
        await writeFile(join(generationDir, fileName), bytes);
        tiers.push({
          actualWidth: width,
          bytes: bytes.length,
          contentType: `image/${format}`,
          format,
          height: width,
          path: fileName,
          quality: 70,
          requestedWidth: width,
          sha256: hash,
          width,
        });
      }
    }
    await writeFile(
      join(generationDir, 'manifest.json'),
      JSON.stringify({
        assetId: asset.assetId,
        createdAt: '2026-10-01T20:00:00.000Z',
        encoder: {
          libvipsVersion: '8.18.6',
          name: 'sharp',
          sharpVersion: '0.35.4',
        },
        merchantId,
        policyVersion: 1,
        recipeId: RECIPE,
        role: asset.role,
        schemaVersion: 1,
        source: {
          bytes: snapshot.length,
          format: 'png',
          orientedHeight: 48,
          orientedWidth: 48,
          sha256: sourceSha,
        },
        tiers,
      })
    );
    // Mirror the lab-config staging layout: committed bytes plus the frozen
    // original under the lab base URL.
    const stageDir = join(publicDir, '__pilot', asset.generationId);
    await mkdir(stageDir, { recursive: true });
    for (const tier of tiers) {
      await copyFile(join(generationDir, tier.path), join(stageDir, tier.path));
    }
    const originalsDir = join(publicDir, '__pilot', 'originals');
    await mkdir(originalsDir, { recursive: true });
    const originalName = `${merchantId}-${asset.assetId}.png`;
    await copyFile(
      join(inputRoot, sourcePath),
      join(originalsDir, originalName)
    );
    staged.push({
      assetId: asset.assetId,
      generationId: asset.generationId,
      merchantId,
      record: {
        assetId: asset.assetId,
        merchantId,
        role: asset.role,
        sha256: sourceSha,
        slot: asset.slot,
        sourcePath,
        url: asset.url,
      },
      role: asset.role,
      slot: asset.slot,
      sourceSha,
      stagedOriginal: `/__pilot/originals/${originalName}`,
      tiers,
    });
  }
  const inventoryPath = join(inputRoot, 'inventory.json');
  await writeFile(
    inventoryPath,
    JSON.stringify(staged.map((entry) => entry.record))
  );
  const acceptancesPath = join(outputRoot, 'acceptances.json');
  await writeFile(
    acceptancesPath,
    JSON.stringify(
      staged.map((entry) => ({
        assetId: entry.assetId,
        generationId: entry.generationId,
        merchantId: entry.merchantId,
        note: 'Lab review: fixture acceptance.',
        outputHashes: entry.tiers.map((tier) => tier.sha256),
        recipeId: RECIPE,
        reviewedAt: '2026-10-01T21:00:00.000Z',
        reviewer: 'pilot-owner',
        schemaVersion: 1,
        sourceSha256: entry.sourceSha,
        verdict: 'accepted',
      }))
    )
  );
  return {
    acceptancesPath,
    assets: staged,
    base,
    inputRoot,
    inventoryPath,
    outputRoot,
    publicDir,
  };
}

async function setupOffline() {
  const fixture = await setupOfflineAssets([
    {
      assetId: 'logo-a',
      generationId: 'e'.repeat(64),
      ladder: [96, 192, 384],
      role: 'logo',
      slot: 'header-logo',
      url: 'https://cdn.example.com/media/logo-a.png',
    },
  ]);
  const [only] = fixture.assets;
  return { ...fixture, generationId: only.generationId, tiers: only.tiers };
}

function offlineOptions(fixture, overrides = {}) {
  return {
    acceptances: fixture.acceptancesPath,
    inputRoot: fixture.inputRoot,
    inventory: fixture.inventoryPath,
    outputRoot: fixture.outputRoot,
    publicDir: fixture.publicDir,
    recipe: RECIPE,
    ...overrides,
  };
}

afterEach(() => {
  // No global state; tmpdir fixtures are unique per test.
});

describe('parsePreflightArgs', () => {
  it('requires the offline roots and pins the recipe by default', () => {
    expect(() => parsePreflightArgs(['--inventory', 'inv.json'])).toThrow(
      /acceptances.*required|missing required/i
    );
    const parsed = parsePreflightArgs([
      '--inventory',
      'inv.json',
      '--acceptances',
      'acc.json',
      '--input-root',
      'in',
      '--output-root',
      'out',
      '--public-dir',
      'pub',
      '--origin',
      'http://localhost:3000',
    ]);
    expect(parsed).toMatchObject({
      acceptances: 'acc.json',
      inventory: 'inv.json',
      origin: 'http://localhost:3000',
      recipe: RECIPE_ID,
    });
    const explicit = parsePreflightArgs([
      '--inventory',
      'inv.json',
      '--acceptances',
      'acc.json',
      '--input-root',
      'in',
      '--output-root',
      'out',
      '--public-dir',
      'pub',
      '--recipe',
      'pilot/other',
    ]);
    expect(explicit.recipe).toBe('pilot/other');
  });
});

describe('assertManifestContract', () => {
  it('agrees with the generator and web schemas on the shared corpus', async () => {
    const corpus = JSON.parse(
      await readFile(join(GENERATOR_FIXTURES, 'contract-fixtures.json'), 'utf8')
    );
    for (const label of [
      'validManifest',
      'validManifestOffset',
      'validManifestGuarded',
    ]) {
      expect(
        assertManifestContract(corpus[label], {
          recipeId: RECIPE,
          role: 'logo',
        }),
        label
      ).toEqual([]);
    }
    for (const [label, candidate] of Object.entries(corpus.invalidManifests)) {
      expect(
        assertManifestContract(candidate, { recipeId: RECIPE, role: 'logo' })
          .length > 0,
        label
      ).toBe(true);
    }
  });

  it('reports non-object tier entries instead of throwing', () => {
    const issues = assertManifestContract(
      { tiers: [null, 'nope', 42] },
      { recipeId: RECIPE, role: 'logo' }
    );
    expect(issues.join('; ')).toMatch(/not an object/);
    expect(issues.join('; ')).toMatch(/ladder/);
  });

  it('matches the route datetime rule exactly (minutes ok, basic offset out)', async () => {
    const corpus = JSON.parse(
      await readFile(join(GENERATOR_FIXTURES, 'contract-fixtures.json'), 'utf8')
    );
    const minute = {
      ...corpus.validManifest,
      createdAt: '2026-10-01T20:00+01:00',
    };
    expect(
      assertManifestContract(minute, { recipeId: RECIPE, role: 'logo' })
    ).toEqual([]);
    const basic = {
      ...corpus.validManifest,
      createdAt: '2026-10-01T20:00:00+0100',
    };
    expect(
      assertManifestContract(basic, {
        recipeId: RECIPE,
        role: 'logo',
      }).join('; ')
    ).toMatch(/createdAt/);
    const impossible = {
      ...corpus.validManifest,
      createdAt: '2026-02-30T20:00:00Z',
    };
    expect(
      assertManifestContract(impossible, {
        recipeId: RECIPE,
        role: 'logo',
      }).join('; ')
    ).toMatch(/createdAt/);
  });

  it('rejects the review-2 quality-zero mutation exactly', async () => {
    const corpus = JSON.parse(
      await readFile(join(GENERATOR_FIXTURES, 'contract-fixtures.json'), 'utf8')
    );
    const issues = assertManifestContract(corpus.invalidManifests.qualityZero, {
      recipeId: RECIPE,
      role: 'logo',
    });
    expect(issues.join('; ')).toMatch(/quality/);
  });
});

describe('runOfflinePreflight', () => {
  it('accepts verified manifests, staged bytes, and decoded dimensions', async () => {
    const fixture = await setupOffline();
    const report = await runOfflinePreflight(offlineOptions(fixture));
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    expect(
      report.checks.some((check) => check.name === 'binding:logo-a:tiers')
    ).toBe(true);
  });

  it('rejects tampered staged bytes', async () => {
    const fixture = await setupOffline();
    await writeFile(
      join(
        fixture.publicDir,
        '__pilot',
        fixture.generationId,
        fixture.tiers[0].path
      ),
      Buffer.from('tampered!!')
    );
    const report = await runOfflinePreflight(offlineOptions(fixture));
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/staged.*hash|hash.*staged/i);
  });

  it('rejects dimension drift between manifest and decoded bytes', async () => {
    const fixture = await setupOffline();
    const manifestPath = join(
      fixture.outputRoot,
      'generations',
      fixture.generationId,
      'manifest.json'
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.tiers[0].width = 9999;
    manifest.tiers[0].actualWidth = 9999;
    await writeFile(manifestPath, JSON.stringify(manifest));
    const report = await runOfflinePreflight(offlineOptions(fixture));
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/dimension|decoded/i);
  });

  it('rejects ladder gaps and hash-set drift against the route contract', async () => {
    const fixture = await setupOffline();
    const manifestPath = join(
      fixture.outputRoot,
      'generations',
      fixture.generationId,
      'manifest.json'
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const dropped = manifest.tiers.pop();
    await writeFile(manifestPath, JSON.stringify(manifest));
    const acceptances = JSON.parse(
      await readFile(fixture.acceptancesPath, 'utf8')
    );
    acceptances[0].outputHashes = acceptances[0].outputHashes.filter(
      (hash) => hash !== dropped.sha256
    );
    await writeFile(fixture.acceptancesPath, JSON.stringify(acceptances));
    const gapped = await runOfflinePreflight(offlineOptions(fixture));
    expect(gapped.ok).toBe(false);
    expect(gapped.failures.join('\n')).toMatch(/ladder/);

    const whole = await setupOffline();
    const wholeAcceptances = JSON.parse(
      await readFile(whole.acceptancesPath, 'utf8')
    );
    wholeAcceptances[0].outputHashes.push('f'.repeat(64));
    await writeFile(whole.acceptancesPath, JSON.stringify(wholeAcceptances));
    const drifted = await runOfflinePreflight(offlineOptions(whole));
    expect(drifted.ok).toBe(false);
    expect(drifted.failures.join('\n')).toMatch(
      /output bytes changed|hashes differ/i
    );
  });

  it('mirrors the route inventory contract (charset, url, dups, cap)', async () => {
    const readInventory = async (fixture) =>
      JSON.parse(await readFile(fixture.inventoryPath, 'utf8'));
    const writeInventory = async (fixture, records) =>
      writeFile(fixture.inventoryPath, JSON.stringify(records));

    const badAsset = await setupOffline();
    const assetRecords = await readInventory(badAsset);
    assetRecords[0].assetId = 'has space!';
    await writeInventory(badAsset, assetRecords);
    const badAssetReport = await runOfflinePreflight(offlineOptions(badAsset));
    expect(badAssetReport.ok).toBe(false);
    expect(badAssetReport.failures.join('\n')).toMatch(/malformed/);

    const badUrl = await setupOffline();
    const urlRecords = await readInventory(badUrl);
    urlRecords[0].url = 'ftp://cdn.example.com/media/logo-a.png';
    await writeInventory(badUrl, urlRecords);
    const badUrlReport = await runOfflinePreflight(offlineOptions(badUrl));
    expect(badUrlReport.ok).toBe(false);
    expect(badUrlReport.failures.join('\n')).toMatch(/malformed/);

    const dupSlot = await setupOffline();
    const slotRecords = await readInventory(dupSlot);
    slotRecords.push({ ...slotRecords[0], assetId: 'logo-b' });
    await writeInventory(dupSlot, slotRecords);
    const dupSlotReport = await runOfflinePreflight(offlineOptions(dupSlot));
    expect(dupSlotReport.ok).toBe(false);
    expect(dupSlotReport.failures.join('\n')).toMatch(/duplicate slot/);

    const dupAsset = await setupOffline();
    const assetDupRecords = await readInventory(dupAsset);
    assetDupRecords.push({ ...assetDupRecords[0], slot: 'product-card' });
    await writeInventory(dupAsset, assetDupRecords);
    const dupAssetReport = await runOfflinePreflight(offlineOptions(dupAsset));
    expect(dupAssetReport.ok).toBe(false);
    expect(dupAssetReport.failures.join('\n')).toMatch(/duplicate asset/);

    const oversized = await setupOffline();
    const manyRecords = await readInventory(oversized);
    for (let index = 0; index < 20; index += 1) {
      manyRecords.push({
        ...manyRecords[0],
        assetId: `logo-extra-${index}`,
        slot: `slot-extra-${index}`,
      });
    }
    await writeInventory(oversized, manyRecords);
    const oversizedReport = await runOfflinePreflight(
      offlineOptions(oversized)
    );
    expect(oversizedReport.ok).toBe(false);
    expect(oversizedReport.failures.join('\n')).toMatch(/at most 20/);

    // The route's z.uuid() requires a version 1-8 + RFC variant nibble
    // (nil/max excepted): shape-valid non-conforming merchants must fail
    // the record mirror, not slip through to a route 500.
    const badMerchant = await setupOffline();
    const merchantRecords = await readInventory(badMerchant);
    merchantRecords[0].merchantId = 'de968340-de02-0aa8-95f9-9d5f7d2b1f20';
    await writeInventory(badMerchant, merchantRecords);
    const badMerchantReport = await runOfflinePreflight(
      offlineOptions(badMerchant)
    );
    expect(badMerchantReport.ok).toBe(false);
    expect(badMerchantReport.failures.join('\n')).toMatch(/malformed/);

    // The route caps slotId at 128 chars (slot becomes slotId).
    const longSlot = await setupOffline();
    const longSlotRecords = await readInventory(longSlot);
    longSlotRecords[0].slot = `s${'l'.repeat(128)}`;
    await writeInventory(longSlot, longSlotRecords);
    const longSlotReport = await runOfflinePreflight(offlineOptions(longSlot));
    expect(longSlotReport.ok).toBe(false);
    expect(longSlotReport.failures.join('\n')).toMatch(/malformed/);
  });

  it('accepts the route UUID edge cases (nil and max)', async () => {
    for (const merchantId of [
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    ]) {
      const fixture = await setupOfflineAssets([
        {
          assetId: 'logo-a',
          generationId: 'e'.repeat(64),
          ladder: [96, 192, 384],
          merchantId,
          role: 'logo',
          slot: 'header-logo',
          url: 'https://cdn.example.com/media/logo-a.png',
        },
      ]);
      const report = await runOfflinePreflight(offlineOptions(fixture));
      expect(report.failures).toEqual([]);
      expect(report.ok).toBe(true);
    }
  });

  it('verifies input snapshots against the inventory claim', async () => {
    const tampered = await setupOffline();
    const inputRecords = JSON.parse(
      await readFile(tampered.inventoryPath, 'utf8')
    );
    const inputPath = join(tampered.inputRoot, inputRecords[0].sourcePath);
    await writeFile(inputPath, 'tampered-bytes');
    const tamperedReport = await runOfflinePreflight(offlineOptions(tampered));
    expect(tamperedReport.ok).toBe(false);
    expect(tamperedReport.failures.join('\n')).toMatch(/:input/);

    const missing = await setupOffline();
    const missingRecords = JSON.parse(
      await readFile(missing.inventoryPath, 'utf8')
    );
    await unlink(join(missing.inputRoot, missingRecords[0].sourcePath));
    const missingReport = await runOfflinePreflight(offlineOptions(missing));
    expect(missingReport.ok).toBe(false);
    expect(missingReport.failures.join('\n')).toMatch(/:input/);
  });

  it('rejects sourcePath shapes the route refuses', async () => {
    // Mirror of lab-route isSafeRelativePath: dot segments, absolute paths,
    // and backslashes never reach the snapshot gate, even when the bytes
    // behind the normalized path would hash correctly.
    for (const sourcePath of [
      'nested/./logo-a.png',
      '/etc/pilot-logo.png',
      'nested\\logo-a.png',
    ]) {
      const fixture = await setupOffline();
      const records = JSON.parse(await readFile(fixture.inventoryPath, 'utf8'));
      await mkdir(join(fixture.inputRoot, 'nested'), { recursive: true });
      await copyFile(
        join(fixture.inputRoot, records[0].sourcePath),
        join(fixture.inputRoot, 'nested', 'logo-a.png')
      );
      records[0].sourcePath = sourcePath;
      await writeFile(fixture.inventoryPath, JSON.stringify(records));
      const report = await runOfflinePreflight(offlineOptions(fixture));
      expect(report.ok).toBe(false);
      expect(report.failures.join('\n')).toMatch(/inventory-parse/);
    }
  });

  it('rejects input snapshots that escape via symlink', async () => {
    // Lexical containment passes `linkdir/evil.png`; only realpath sees the
    // link target outside the input root.
    const fixture = await setupOffline();
    const outside = join(fixture.base, 'outside');
    await mkdir(outside, { recursive: true });
    const records = JSON.parse(await readFile(fixture.inventoryPath, 'utf8'));
    await copyFile(
      join(fixture.inputRoot, records[0].sourcePath),
      join(outside, 'evil.png')
    );
    await symlink(outside, join(fixture.inputRoot, 'linkdir'));
    records[0].sourcePath = 'linkdir/evil.png';
    await writeFile(fixture.inventoryPath, JSON.stringify(records));
    const report = await runOfflinePreflight(offlineOptions(fixture));
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/:input/);
  });

  it('enforces the full acceptance contract (lengths, dates, keys, hashes)', async () => {
    const cases = {
      assetIdTooLong: (record) => {
        record.assetId = `a${'x'.repeat(128)}`;
      },
      extraKey: (record) => {
        record.approver = 'pilot-owner';
      },
      missingNote: (record) => {
        delete record.note;
      },
      missingReviewer: (record) => {
        delete record.reviewer;
      },
      naiveReviewedAt: (record) => {
        record.reviewedAt = '2026-10-01T21:00:00';
      },
      impossibleReviewedAt: (record) => {
        record.reviewedAt = '2026-02-30T21:00:00Z';
      },
      noteTooLong: (record) => {
        record.note = `n${'o'.repeat(500)}`;
      },
      recipeIdTooLong: (record) => {
        record.recipeId = `r${'e'.repeat(64)}`;
      },
      schemaVersionMismatch: (record) => {
        record.schemaVersion = 2;
      },
      tooManyHashes: (record) => {
        record.outputHashes = Array.from(
          { length: 25 },
          (_, index) => `${index.toString(16).padStart(64, '0')}`
        );
      },
    };
    for (const [label, mutate] of Object.entries(cases)) {
      const fixture = await setupOffline();
      const records = JSON.parse(
        await readFile(fixture.acceptancesPath, 'utf8')
      );
      mutate(records[0]);
      await writeFile(fixture.acceptancesPath, JSON.stringify(records));
      const report = await runOfflinePreflight(offlineOptions(fixture));
      expect(report.ok, label).toBe(false);
      expect(report.failures.join('\n'), label).toMatch(/malformed acceptance/);
    }
  });

  it('keeps served check names stable when details contain separators', async () => {
    const fixture = await setupOffline();
    // Width lie: the srcSet claims 999w for a staged 384px tier.
    const html = labHtml({ arm: 'pilot', ...fixture }).replaceAll(
      '384w',
      '999w'
    );
    const report = await fetchServedAgreement('http://unused.invalid', {
      arms: ['pilot'],
      expectedBindings: [`${MERCHANT}/hero-s0`, `${MERCHANT}/logo-a`],
      fetchImpl: async () => html,
      publicDir: fixture.publicDir,
    });
    expect(report.ok).toBe(false);
    // Four width lies (hero/logo x avif/webp): every failing check keeps
    // the bare gate name and every entry carries one prefix.
    const failed = report.checks.filter((check) => !check.ok);
    expect(failed).toHaveLength(4);
    for (const check of failed) {
      expect(check.name).toBe('served:pilot:descriptors');
    }
    expect(report.failures).toHaveLength(4);
    for (const failure of report.failures) {
      expect(failure).toMatch(
        /^served:pilot:descriptors: descriptor 999w does not match decoded width 384: /
      );
    }
  });

  it('pins the recipe and rejects caller overrides', async () => {
    const fixture = await setupOffline();
    const { recipe: _ignored, ...withoutRecipe } = offlineOptions(fixture);
    const pinned = await runOfflinePreflight(withoutRecipe);
    expect(pinned.failures).toEqual([]);
    expect(pinned.ok).toBe(true);
    const override = await runOfflinePreflight(
      offlineOptions(fixture, { recipe: 'pilot/other' })
    );
    expect(override.ok).toBe(false);
    expect(override.failures.join('\n')).toMatch(/pinned recipe/);
  });

  it('rejects stale recipes, missing acceptances, and conflicting duplicates', async () => {
    const fixture = await setupOffline();
    const stale = await runOfflinePreflight(
      offlineOptions(fixture, { recipe: 'pilot/other' })
    );
    expect(stale.ok).toBe(false);
    expect(stale.failures.join('\n')).toMatch(/recipe/i);

    await writeFile(fixture.acceptancesPath, JSON.stringify([]));
    const missing = await runOfflinePreflight(offlineOptions(fixture));
    expect(missing.ok).toBe(false);
    expect(missing.failures.join('\n')).toMatch(/acceptance/i);

    const acceptances = [
      {
        assetId: 'logo-a',
        generationId: fixture.generationId,
        merchantId: MERCHANT,
        note: 'n',
        outputHashes: fixture.tiers.map((tier) => tier.sha256),
        recipeId: RECIPE,
        reviewedAt: '2026-10-01T21:00:00.000Z',
        reviewer: 'pilot-owner',
        schemaVersion: 1,
        sourceSha256: JSON.parse(
          await readFile(fixture.inventoryPath, 'utf8')
        )[0].sha256,
        verdict: 'accepted',
      },
    ];
    await writeFile(
      fixture.acceptancesPath,
      JSON.stringify([
        ...acceptances,
        { ...acceptances[0], verdict: 'rejected' },
      ])
    );
    const conflict = await runOfflinePreflight(offlineOptions(fixture));
    expect(conflict.ok).toBe(false);
    expect(conflict.failures.join('\n')).toMatch(/duplicate|conflict/i);
  });
});

function labHtml({ arm, generationId, tiers }) {
  const srcSetFor = (format) =>
    tiers
      .filter((tier) => tier.format === format)
      .map((tier) => `/__pilot/${generationId}/${tier.path} ${tier.width}w`)
      .join(', ');
  const avif = srcSetFor('avif');
  const webp = srcSetFor('webp');
  const smallestTier = tiers.find((tier) => tier.format === 'avif');
  const smallest = smallestTier
    ? `/__pilot/${generationId}/${smallestTier.path}`
    : `/__pilot/${generationId}/placeholder.avif`;
  return `<!doctype html><html><body><main data-pilot-lab-arm="${arm}">
<section data-pilot-lab-slot="mobile-hero-slide-0" data-pilot-lab-binding="${MERCHANT}/hero-s0"><link rel="preload" as="image" href="${smallest}" imageSrcSet="${avif}" imageSizes="(max-width: 768px) 40vw, 152px" media="(max-width: 768px)" fetchPriority="high" type="image/avif" data-pilot-lab-preload="${arm}" data-pilot-lab-binding="${MERCHANT}/hero-s0"/><picture data-pilot-lab-picture="${arm}"><source media="(max-width: 768px)" sizes="(max-width: 768px) 40vw, 152px" srcSet="${avif}" type="image/avif"/><source media="(max-width: 768px)" sizes="(max-width: 768px) 40vw, 152px" srcSet="${webp}"/></picture></section>
<section data-pilot-lab-slot="header-logo" data-pilot-lab-binding="${MERCHANT}/logo-a"><picture data-pilot-lab-picture="${arm}"><source sizes="40px" srcSet="${avif}" type="image/avif"/><source sizes="40px" srcSet="${webp}" type="image/webp"/></picture></section>
</main></body></html>`;
}

describe('served agreement', () => {
  const unitTiers = [
    { format: 'avif', path: 'a.avif', width: 48 },
    { format: 'webp', path: 'w.webp', width: 48 },
  ];

  it('extracts lab preloads and pictures from served HTML', () => {
    const html = labHtml({
      arm: 'pilot',
      generationId: 'e'.repeat(64),
      tiers: unitTiers,
    });
    expect(extractLabPreloads(html)).toHaveLength(1);
    expect(extractLabPictures(html)).toHaveLength(2);
  });

  it('proves hint owners agree with the rendered picture', () => {
    const fixture = { generationId: 'e'.repeat(64), tiers: unitTiers };
    const html = labHtml({ arm: 'pilot', ...fixture });
    expect(assertServedAgreement(html, { arm: 'pilot' })).toEqual([]);
    const drifted = html.replace('40vw, 152px" media', '40vw, 999px" media');
    expect(
      assertServedAgreement(drifted, { arm: 'pilot' }).length
    ).toBeGreaterThan(0);
  });

  it('requires hint and render to choose the same pass-through resource', () => {
    const passthrough = [
      { format: 'avif', path: `${'f'.repeat(64)}.avif`, width: 800 },
      { format: 'webp', path: 'w.webp', width: 384 },
    ];
    const html = labHtml({
      arm: 'pilot',
      generationId: 'e'.repeat(64),
      tiers: passthrough,
    });
    expect(assertServedAgreement(html, { arm: 'pilot' })).toEqual([]);
    // Stale hint: the preload still points at the previous generation's
    // file while the render serves this generation's pass-through copy.
    const staleHref = `/__pilot/${'d'.repeat(64)}/${'f'.repeat(64)}.avif`;
    const stale = html.replace(/href="[^"]*"/, `href="${staleHref}"`);
    expect(assertServedAgreement(stale, { arm: 'pilot' }).join('\n')).toMatch(
      /not one of the preloaded candidates/
    );
    // Mismatched selection: the hint carries a different candidate list
    // than the rendered pass-through source.
    const mismatch = html.replace(
      /imageSrcSet="[^"]*"/,
      'imageSrcSet="/__pilot/stale.avif 800w"'
    );
    expect(
      assertServedAgreement(mismatch, { arm: 'pilot' }).join('\n')
    ).toMatch(/imageSrcSet differs/);
  });

  it('fetches both arms and verifies descriptors against staged bytes', async () => {
    const fixture = await setupOffline();
    const original = `/__pilot/originals/${MERCHANT}-logo-a.png`;
    const serveFile = async (res, urlPath) => {
      try {
        const bytes = await readFile(join(fixture.publicDir, urlPath));
        res
          .writeHead(200, { 'content-type': 'application/octet-stream' })
          .end(bytes);
      } catch {
        res.writeHead(404).end('missing');
      }
    };
    const pages = {
      '/pilot-lab?arm=pilot': labHtml({ arm: 'pilot', ...fixture }),
      '/pilot-lab?arm=control': `<!doctype html><html><body><main data-pilot-lab-arm="control"><section data-pilot-lab-slot="mobile-hero-slide-0" data-pilot-lab-binding="${MERCHANT}/hero-s0"><link rel="preload" as="image" href="${original}" imageSrcSet="${original}" imageSizes="(max-width: 768px) 40vw, 152px" media="(max-width: 768px)" fetchPriority="high" data-pilot-lab-preload="control" data-pilot-lab-binding="${MERCHANT}/hero-s0"/><picture data-pilot-lab-picture="control"><source media="(max-width: 768px)" sizes="(max-width: 768px) 40vw, 152px" srcSet="${original}" type="image/avif"/><source media="(max-width: 768px)" sizes="(max-width: 768px) 40vw, 152px" srcSet="${original}"/></picture></section><section data-pilot-lab-slot="header-logo" data-pilot-lab-binding="${MERCHANT}/logo-a"><picture data-pilot-lab-picture="control"><source sizes="40px" srcSet="${original}" type="image/avif"/><source sizes="40px" srcSet="${original}" type="image/webp"/></picture></section></main></body></html>`,
    };
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '';
      const body = pages[urlPath];
      if (body) {
        res.writeHead(200, { 'content-type': 'text/html' }).end(body);
        return;
      }
      if (urlPath.startsWith('/__pilot/')) {
        serveFile(res, urlPath).catch(() => res.writeHead(500).end('error'));
        return;
      }
      res.writeHead(404).end('nope');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const report = await fetchServedAgreement(origin, {
        arms: ['pilot', 'control'],
        publicDir: fixture.publicDir,
      });
      expect(report.failures).toEqual([]);
      expect(report.ok).toBe(true);
      expect(
        report.checks.some(
          (check) => check.name === 'served:pilot:response-bytes' && check.ok
        )
      ).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('rejects served image bytes that differ from the staged hashes', async () => {
    const fixture = await setupOffline();
    const html = labHtml({ arm: 'pilot', ...fixture });
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '';
      if (urlPath === '/pilot-lab?arm=pilot') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(html);
        return;
      }
      // Correct HTML, wrong bytes: every image URL 404s.
      res.writeHead(404).end('missing');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const report = await fetchServedAgreement(origin, {
        arms: ['pilot'],
        publicDir: fixture.publicDir,
      });
      expect(report.ok).toBe(false);
      expect(report.failures.join('\n')).toMatch(/response-bytes/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('proves every expected binding renders in the served arm', async () => {
    const fixture = await setupOffline();
    const html = labHtml({ arm: 'pilot', ...fixture });
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '';
      if (urlPath === '/pilot-lab?arm=pilot') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(html);
        return;
      }
      if (urlPath.startsWith('/__pilot/')) {
        readFile(join(fixture.publicDir, urlPath))
          .then((bytes) => res.writeHead(200).end(bytes))
          .catch(() => res.writeHead(404).end('missing'));
        return;
      }
      res.writeHead(404).end('nope');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const expectedBindings = [`${MERCHANT}/hero-s0`, `${MERCHANT}/logo-a`];
      const covered = await fetchServedAgreement(origin, {
        arms: ['pilot'],
        expectedBindings,
        publicDir: fixture.publicDir,
      });
      expect(covered.failures).toEqual([]);
      expect(covered.ok).toBe(true);
      const dropped = await fetchServedAgreement(origin, {
        arms: ['pilot'],
        expectedBindings: [...expectedBindings, `${MERCHANT}/ghost`],
        publicDir: fixture.publicDir,
      });
      expect(dropped.ok).toBe(false);
      expect(dropped.failures.join('\n')).toMatch(/binding-coverage/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('rejects descriptor lies and control-arm tier leaks over the wire', async () => {
    const fixture = await setupOffline();
    const good = labHtml({ arm: 'pilot', ...fixture });
    // Lie consistently in link and picture so owner agreement holds while
    // the descriptor no longer matches the decoded staged bytes.
    const lied = good.replaceAll(' 96w', ' 97w');
    const leakedControl = good
      .replaceAll('data-pilot-lab-arm="pilot"', 'data-pilot-lab-arm="control"')
      .replaceAll(
        'data-pilot-lab-preload="pilot"',
        'data-pilot-lab-preload="control"'
      )
      .replaceAll(
        'data-pilot-lab-picture="pilot"',
        'data-pilot-lab-picture="control"'
      );
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      let body = '';
      if (url === '/pilot-lab?arm=pilot') {
        body = lied;
      } else if (url === '/pilot-lab?arm=control') {
        body = leakedControl;
      }
      res.writeHead(200, { 'content-type': 'text/html' }).end(body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const report = await fetchServedAgreement(origin, {
        arms: ['pilot', 'control'],
        publicDir: fixture.publicDir,
      });
      expect(report.ok).toBe(false);
      expect(report.failures.join('\n')).toMatch(/descriptor|leak/i);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('runPreflight', () => {
  it('combines offline and served gates', async () => {
    const fixture = await setupOffline();
    const offlineOnly = await runPreflight(offlineOptions(fixture));
    expect(offlineOnly.ok).toBe(true);
    expect(offlineOnly.served).toBeNull();
  });
});

function mountFor(asset) {
  return {
    assetId: asset.assetId,
    binding: `${asset.merchantId}/${asset.assetId}`,
    generationId: asset.generationId,
    merchantId: asset.merchantId,
    role: asset.role,
    slotId: asset.slot,
    stagedOriginal: asset.stagedOriginal,
  };
}

function notOptimizedSection(binding, slotId) {
  return `<section data-pilot-lab-slot="${slotId}" data-pilot-lab-binding="${binding}" data-pilot-lab-status="not-optimized"><h2>${slotId} — not optimized</h2><p>fixture row</p></section>`;
}

function replaceHeroSection(html, replacement) {
  return String(html).replace(
    /<section data-pilot-lab-slot="mobile-hero-slide-0"[\s\S]*?<\/section>/,
    replacement
  );
}

async function serveStaged(res, publicDir, urlPath) {
  // Static serving ignores the query: original-renderer ?w&q URLs hash
  // against the query-stripped staged file.
  const base = urlPath.split('?')[0];
  try {
    const bytes = await readFile(join(publicDir, base));
    res
      .writeHead(200, { 'content-type': 'application/octet-stream' })
      .end(bytes);
  } catch {
    res.writeHead(404).end('missing');
  }
}

function srcSetFor(asset, generationId, format) {
  return asset.tiers
    .filter((tier) => tier.format === format)
    .map((tier) => `/__pilot/${generationId}/${tier.path} ${tier.width}w`)
    .join(', ');
}

function storeLogoPilotPage({ arm, asset, heroRow }) {
  const avif = srcSetFor(asset, asset.generationId, 'avif');
  const webp = srcSetFor(asset, asset.generationId, 'webp');
  const fallback = asset.tiers.find((tier) => tier.format === 'webp');
  return `<!doctype html><html><body><div data-pilot-lab-arm="${arm}"><main><section data-pilot-lab-binding="${asset.merchantId}/${asset.assetId}" data-pilot-lab-slot="header-logo"><header data-pilot-lab-store-header="Labstore"><a href="/pilot-lab/store/labstore/"><picture data-pilot-lab-header-logo="true"><source sizes="40px" srcSet="${avif}" type="image/avif"/><source sizes="40px" srcSet="${webp}" type="image/webp"/><img src="/__pilot/${asset.generationId}/${fallback.path}" alt="Labstore" width="40" height="40"/></picture><span>Labstore</span></a></header></section>${heroRow}</main></div></body></html>`;
}

function storeLogoControlPage({ asset, heroRow }) {
  const staged = asset.stagedOriginal;
  return `<!doctype html><html><body><div data-pilot-lab-arm="control"><main><section data-pilot-lab-binding="${asset.merchantId}/${asset.assetId}" data-pilot-lab-slot="header-logo"><header data-pilot-lab-store-header="Labstore"><a href="/pilot-lab/store/labstore/"><img src="${staged}?w=48&q=75" srcSet="${staged}?w=48&q=75 1x, ${staged}?w=96&q=75 2x" alt="Labstore" width="40" height="40"/></a></header></section>${heroRow}</main></div></body></html>`;
}

describe('served mount coverage', () => {
  it('returns the offline-accepted bindings with staged identities', async () => {
    const fixture = await setupOffline();
    const report = await runOfflinePreflight(offlineOptions(fixture));
    expect(report.ok).toBe(true);
    expect(report.accepted).toHaveLength(1);
    expect(report.accepted[0]).toMatchObject({
      binding: `${MERCHANT}/logo-a`,
      generationId: fixture.generationId,
      role: 'logo',
      slotId: 'header-logo',
      stagedOriginal: `/__pilot/originals/${MERCHANT}-logo-a.png`,
    });
  });

  it('fails when an expected hero renders only not-optimized (review-2 repro)', async () => {
    const fixture = await setupOffline();
    const [logo] = fixture.assets;
    const heroBinding = `${MERCHANT}/hero-s0`;
    // Valid logo mount, hero reporting row only — the review's step-5 shape.
    const html = replaceHeroSection(
      labHtml({ arm: 'pilot', ...fixture }),
      notOptimizedSection(heroBinding, 'mobile-hero-slide-0')
    );
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '';
      if (urlPath === '/pilot-lab?arm=pilot') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(html);
        return;
      }
      if (urlPath.startsWith('/__pilot/')) {
        serveStaged(res, fixture.publicDir, urlPath).catch(() =>
          res.writeHead(500).end('error')
        );
        return;
      }
      res.writeHead(404).end('nope');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const expectedMounts = [
        {
          assetId: 'hero-s0',
          binding: heroBinding,
          generationId: 'd'.repeat(64),
          merchantId: MERCHANT,
          role: 'hero',
          slotId: 'mobile-hero-slide-0',
          stagedOriginal: `/__pilot/originals/${MERCHANT}-hero-s0.png`,
        },
        mountFor(logo),
      ];
      const report = await fetchServedAgreement(origin, {
        arms: ['pilot'],
        expectedBindings: expectedMounts.map((mount) => mount.binding),
        expectedMounts,
        publicDir: fixture.publicDir,
      });
      expect(report.ok).toBe(false);
      expect(report.failures.join('\n')).toMatch(/mount-coverage/);
      expect(report.failures.join('\n')).toMatch(
        /renders only "not-optimized"/
      );
      expect(report.coverage[0].mounted).toEqual([`${MERCHANT}/logo-a`]);
      expect(report.coverage[0].reported).toEqual([
        {
          binding: heroBinding,
          slotId: 'mobile-hero-slide-0',
          status: 'not-optimized',
        },
      ]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('excludes rejected bindings from optimized coverage (reported, not counted)', async () => {
    const fixture = await setupOffline();
    const [logo] = fixture.assets;
    const heroBinding = `${MERCHANT}/hero-s0`;
    const html = replaceHeroSection(
      labHtml({ arm: 'pilot', ...fixture }),
      notOptimizedSection(heroBinding, 'mobile-hero-slide-0')
    );
    // Offline rejected the hero: it is absent from expectedMounts, exactly
    // as runOfflinePreflight reports it.
    const report = await fetchServedAgreement('http://unused.invalid', {
      arms: ['pilot'],
      expectedBindings: [heroBinding, `${MERCHANT}/logo-a`],
      expectedMounts: [mountFor(logo)],
      fetchImpl: async () => html,
      publicDir: fixture.publicDir,
    });
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.coverage[0].mounted).toEqual([`${MERCHANT}/logo-a`]);
    expect(report.coverage[0].reported).toEqual([
      {
        binding: heroBinding,
        slotId: 'mobile-hero-slide-0',
        status: 'not-optimized',
      },
    ]);
  });

  it('fails absent expected mounts and unlinked hero pictures', () => {
    const fixture = { generationId: 'e'.repeat(64), tiers: [] };
    const heroMount = {
      assetId: 'hero-s0',
      binding: `${MERCHANT}/hero-s0`,
      generationId: 'e'.repeat(64),
      merchantId: MERCHANT,
      role: 'hero',
      slotId: 'mobile-hero-slide-0',
      stagedOriginal: `/__pilot/originals/${MERCHANT}-hero-s0.png`,
    };
    // No hero section at all: absent, not vacuously covered.
    const empty = `<main data-pilot-lab-arm="pilot"></main>`;
    const absent = assertServedMountCoverage(empty, {
      arm: 'pilot',
      expectedMounts: [heroMount],
      surface: 'gallery',
    });
    expect(absent.failures.join('\n')).toMatch(/absent from the served/);
    expect(absent.mounted).toEqual([]);
    // Mounted hero picture with no section link: no zero-to-zero pass.
    const unlinked = `<main data-pilot-lab-arm="pilot"><section data-pilot-lab-slot="mobile-hero-slide-0" data-pilot-lab-binding="${MERCHANT}/hero-s0"><picture data-pilot-lab-picture="pilot"><source media="m" sizes="s" srcSet="u" type="image/avif"/></picture></section></main>`;
    expect(
      assertServedAgreement(unlinked, { arm: 'pilot' }).join('\n')
    ).toMatch(/has no preload link/);
    void fixture;
  });

  it('binds store card coverage to the selected card, never a filler', () => {
    const origin = 'http://localhost:3129';
    const mount = {
      assetId: 'card-a',
      binding: `${MERCHANT}/card-a`,
      generationId: 'c'.repeat(64),
      merchantId: MERCHANT,
      role: 'product',
      slotId: 'product-card',
      stagedOriginal: `/__pilot/originals/${MERCHANT}-card-a.png`,
    };
    const section = (selected, filler) =>
      `<main data-pilot-lab-arm="control"><section data-pilot-lab-slot="product-card" data-pilot-lab-binding="${mount.binding}"><div data-pilot-lab-selected-card="true">${selected}</div><article>${filler}</article></section></main>`;
    const staged = `<img src="${origin}${mount.stagedOriginal}?w=384&q=75" srcset="${origin}${mount.stagedOriginal}?w=384&q=75 384w" alt="card">`;
    const broken = `<img src="/placeholder.svg" alt="Selected product">`;
    const check = (html) =>
      assertServedMountCoverage(html, {
        arm: 'control',
        expectedMounts: [mount],
        origin,
        surface: 'store',
      });
    // Review-3 repro: broken selected card, correct filler — must fail.
    const falsePositive = check(section(broken, staged));
    expect(falsePositive.failures.join('\n')).toMatch(
      /does not serve the staged original/
    );
    expect(falsePositive.mounted).toEqual([]);
    // Correct selected card, broken filler — coverage holds (descriptors
    // own filler hygiene section-wide).
    const covered = check(section(staged, broken));
    expect(covered.failures).toEqual([]);
    expect(covered.mounted).toEqual([mount.binding]);
  });

  it('fails pilot mounts that fetch a staged original alongside the generation copy', () => {
    const origin = 'http://localhost:3129';
    const mount = {
      assetId: 'card-a',
      binding: `${MERCHANT}/card-a`,
      generationId: 'c'.repeat(64),
      merchantId: MERCHANT,
      role: 'product',
      slotId: 'product-card',
      stagedOriginal: `/__pilot/originals/${MERCHANT}-card-a.png`,
    };
    const gen = (file) => `/__pilot/${mount.generationId}/${file}`;
    const picture = `<picture data-pilot-lab-picture="pilot" data-pilot-lab-card-image="true"><source sizes="s" srcSet="${gen('a.avif')} 48w" type="image/avif"/><source sizes="s" srcSet="${gen('w.webp')} 48w" type="image/webp"/></picture>`;
    const section = (extra) =>
      `<main data-pilot-lab-arm="pilot"><section data-pilot-lab-slot="product-card" data-pilot-lab-binding="${mount.binding}"><div data-pilot-lab-selected-card="true">${picture}${extra}</div></section></main>`;
    const check = (html) =>
      assertServedMountCoverage(html, {
        arm: 'pilot',
        expectedMounts: [mount],
        origin,
        surface: 'store',
      });
    // Generation copy only: intended delivery (including pass-through
    // copies), no leak.
    const clean = check(section(''));
    expect(clean.failures).toEqual([]);
    expect(clean.mounted).toEqual([mount.binding]);
    // Same generation copy plus a staged-original fetch: an accidental
    // double download, even though the mount serves this generation.
    const leaked = check(
      section(`<img src="${mount.stagedOriginal}" alt="x">`)
    );
    expect(leaked.failures.join('\n')).toMatch(
      /instead of the generation copy/
    );
    expect(leaked.mounted).toEqual([]);
  });

  it('pairs hints within their own section, never across sections', () => {
    const avif = `/__pilot/${'e'.repeat(64)}/a.avif 48w`;
    // The hero link sits in the LOGO section with attrs that would pair by
    // document order; section scoping must still fail the link-less hero.
    const html = `<main data-pilot-lab-arm="pilot"><section data-pilot-lab-slot="mobile-hero-slide-0" data-pilot-lab-binding="${MERCHANT}/hero-s0"><picture data-pilot-lab-picture="pilot"><source media="m" sizes="s" srcSet="${avif}" type="image/avif"/></picture></section><section data-pilot-lab-slot="header-logo" data-pilot-lab-binding="${MERCHANT}/logo-a"><link rel="preload" as="image" href="/__pilot/a" imageSrcSet="${avif}" imageSizes="s" media="m" fetchPriority="high" type="image/avif" data-pilot-lab-preload="pilot"/><picture data-pilot-lab-picture="pilot"><source sizes="40px" srcSet="${avif}" type="image/avif"/></picture></section></main>`;
    expect(assertServedAgreement(html, { arm: 'pilot' }).join('\n')).toMatch(
      /has no preload link/
    );
  });

  it('enforces the per-arm format gate on hero links', () => {
    const unitTiers = [
      { format: 'avif', path: 'a.avif', width: 48 },
      { format: 'webp', path: 'w.webp', width: 48 },
    ];
    const typed = labHtml({
      arm: 'control',
      generationId: 'e'.repeat(64),
      tiers: unitTiers,
    });
    expect(assertServedAgreement(typed, { arm: 'control' }).join('\n')).toMatch(
      /wrong format gate/
    );
    const untyped = labHtml({
      arm: 'pilot',
      generationId: 'e'.repeat(64),
      tiers: unitTiers,
    }).replace(
      'fetchPriority="high" type="image/avif" data-pilot-lab-preload',
      'fetchPriority="high" data-pilot-lab-preload'
    );
    expect(assertServedAgreement(untyped, { arm: 'pilot' }).join('\n')).toMatch(
      /wrong format gate/
    );
  });

  it('fails pilot mounts that serve the wrong generation', async () => {
    const fixture = await setupOffline();
    const [logo] = fixture.assets;
    const html = labHtml({ arm: 'pilot', ...fixture });
    const wrongGen = {
      ...mountFor(logo),
      generationId: 'f'.repeat(64),
    };
    const report = await fetchServedAgreement('http://unused.invalid', {
      arms: ['pilot'],
      expectedBindings: [`${MERCHANT}/logo-a`, `${MERCHANT}/hero-s0`],
      expectedMounts: [wrongGen],
      fetchImpl: async () => html,
      publicDir: fixture.publicDir,
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(
      /pilot logo mount does not serve this generation/
    );
  });

  it('fails unreachable pages before any mount verdict', async () => {
    const report = await fetchServedAgreement('http://unused.invalid', {
      arms: ['pilot'],
      expectedBindings: [],
      expectedMounts: [],
      fetchImpl: () => {
        throw new Error('connection refused');
      },
      publicDir: '/nonexistent',
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/reachable/);
  });

  it('treats loader-param descriptors as existence checks, not width lies', async () => {
    const fixture = await setupOffline();
    const [logo] = fixture.assets;
    const staged = logo.stagedOriginal;
    // Deliberately wrong ?w= descriptors over the real staged file: the
    // original renderers name requested widths, so this must pass.
    const controlHtml = `<!doctype html><html><body><div data-pilot-lab-arm="control"><main><section data-pilot-lab-binding="${MERCHANT}/logo-a" data-pilot-lab-slot="header-logo"><img src="${staged}?w=9999&q=75" srcSet="${staged}?w=9999&q=75 1x" alt="Labstore" width="40" height="40"/></section></main></div></body></html>`;
    const passing = await fetchServedAgreement('http://unused.invalid', {
      arms: ['control'],
      expectedBindings: [`${MERCHANT}/logo-a`],
      expectedMounts: [],
      fetchImpl: async () => controlHtml,
      publicDir: fixture.publicDir,
    });
    expect(passing.failures).toEqual([]);
    expect(passing.ok).toBe(true);
    // Same shape over a missing file: existence still fails closed.
    const missingHtml = controlHtml.replaceAll(
      staged,
      '/__pilot/originals/gone.png'
    );
    const failing = await fetchServedAgreement('http://unused.invalid', {
      arms: ['control'],
      expectedBindings: [`${MERCHANT}/logo-a`],
      expectedMounts: [],
      fetchImpl: async () => missingHtml,
      publicDir: fixture.publicDir,
    });
    expect(failing.ok).toBe(false);
    expect(failing.failures.join('\n')).toMatch(/does not decode/);
  });

  it('parses and validates the merchant-to-slug store map', () => {
    expect(parseStoreMap(`${MERCHANT}=ogabassey`)).toEqual({
      [MERCHANT]: 'ogabassey',
    });
    expect(parseStoreMap(null)).toEqual({});
    expect(() => parseStoreMap('no-equals')).toThrow(/merchantId=slug/);
    expect(() => parseStoreMap('nope=slug')).toThrow(/not a UUID/);
    expect(() => parseStoreMap(`${MERCHANT}=Bad_Slug`)).toThrow(/slug/);
  });

  it('fails closed when a merchant has no store slug', async () => {
    const fixture = await setupOffline();
    const report = await runPreflight({
      ...offlineOptions(fixture),
      origin: 'http://127.0.0.1:1',
      storeMap: null,
    });
    expect(report.ok).toBe(false);
    expect(report.served).toBeNull();
    expect(report.failures.join('\n')).toMatch(/store-map/);
  });

  it('extracts binding sections with their reporting status', () => {
    const html = `<section data-pilot-lab-binding="m/a" data-pilot-lab-slot="header-logo"><picture></picture></section>${notOptimizedSection('m/b', 'product-card')}<section data-pilot-lab-slot="product-card" data-pilot-lab-status="missing-binding"><h2>x</h2></section><section><p>unrelated</p></section>`;
    const sections = extractLabSections(html);
    expect(sections).toHaveLength(3);
    expect(sections[0]).toMatchObject({
      binding: 'm/a',
      slotId: 'header-logo',
      status: null,
    });
    expect(sections[1]).toMatchObject({
      binding: 'm/b',
      status: 'not-optimized',
    });
    expect(sections[2]).toMatchObject({
      binding: null,
      status: 'missing-binding',
    });
  });
});

describe('review-2 combined repro', () => {
  it('fails offline on the quality-zero hero while served correctly excludes it', async () => {
    const fixture = await setupOfflineAssets([
      {
        assetId: 'logo-a',
        generationId: 'e'.repeat(64),
        ladder: [96, 192, 384],
        role: 'logo',
        slot: 'header-logo',
        url: 'https://cdn.example.com/media/logo-a.png',
      },
      {
        assetId: 'hero-s0',
        generationId: 'd'.repeat(64),
        ladder: [384, 768, 1280],
        role: 'hero',
        slot: 'mobile-hero-slide-0',
        url: 'https://cdn.example.com/media/hero-s0.png',
      },
    ]);
    const [logo, hero] = fixture.assets;
    // The review's exact mutation: quality 0, bytes/hashes/ladder unchanged.
    const manifestPath = join(
      fixture.outputRoot,
      'generations',
      hero.generationId,
      'manifest.json'
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.tiers[0].quality = 0;
    await writeFile(manifestPath, JSON.stringify(manifest));

    const offline = await runOfflinePreflight(offlineOptions(fixture));
    expect(offline.ok).toBe(false);
    expect(offline.failures.join('\n')).toMatch(/quality/);
    expect(offline.accepted.map((entry) => entry.binding)).toEqual([
      `${MERCHANT}/logo-a`,
    ]);

    // Served pages reflect the route's invalid-manifest fallback: the hero
    // renders a reporting row on every surface while the logo stays mounted.
    const heroRow = notOptimizedSection(
      `${MERCHANT}/hero-s0`,
      'mobile-hero-slide-0'
    );
    const galleryFor = (arm) => {
      const logoPage = labHtml({
        arm,
        generationId: logo.generationId,
        tiers: logo.tiers,
      });
      const page = replaceHeroSection(logoPage, heroRow);
      if (arm === 'pilot') {
        return page;
      }
      // Gallery control mounts serve the bare staged original (no tier
      // URLs, no AVIF gate on the hint).
      return page
        .replace(
          'fetchPriority="high" type="image/avif" data-pilot-lab-preload',
          'fetchPriority="high" data-pilot-lab-preload'
        )
        .replaceAll(/srcSet="[^"]*"/g, `srcSet="${logo.stagedOriginal}"`)
        .replaceAll(
          /href="\/__pilot\/[^"]*"/g,
          `href="${logo.stagedOriginal}"`
        );
    };
    const pages = {
      '/pilot-lab?arm=pilot': galleryFor('pilot'),
      '/pilot-lab?arm=control': galleryFor('control'),
      '/pilot-lab/store/labstore?arm=pilot': storeLogoPilotPage({
        arm: 'pilot',
        asset: logo,
        heroRow,
      }),
      '/pilot-lab/store/labstore?arm=control': storeLogoControlPage({
        asset: logo,
        heroRow,
      }),
    };
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '';
      const body = pages[urlPath];
      if (body) {
        res.writeHead(200, { 'content-type': 'text/html' }).end(body);
        return;
      }
      if (urlPath.split('?')[0].startsWith('/__pilot/')) {
        serveStaged(res, fixture.publicDir, urlPath).catch(() =>
          res.writeHead(500).end('error')
        );
        return;
      }
      res.writeHead(404).end('nope');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const report = await runPreflight({
        ...offlineOptions(fixture),
        origin,
        storeMap: `${MERCHANT}=labstore`,
      });
      // Combined verdict fails via offline (the schema-invalid hero), while
      // every served mount gate passes (the hero is reported, not counted).
      expect(report.ok).toBe(false);
      expect(report.failures.join('\n')).toMatch(/quality/);
      expect(report.failures.join('\n')).not.toMatch(/mount-coverage/);
      expect(report.coverage).toHaveLength(4);
      for (const entry of report.coverage) {
        expect(entry.mounted).toEqual([`${MERCHANT}/logo-a`]);
        expect(entry.reported).toEqual([
          {
            binding: `${MERCHANT}/hero-s0`,
            slotId: 'mobile-hero-slide-0',
            status: 'not-optimized',
          },
        ]);
      }
      expect(
        report.checks.some(
          (check) =>
            check.name === 'served:store:labstore:pilot:mount-coverage' &&
            check.ok
        )
      ).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('served hoisting and absolute URLs', () => {
  const unitTiers = [
    { format: 'avif', path: 'a.avif', width: 48 },
    { format: 'webp', path: 'w.webp', width: 48 },
  ];

  // React hoists <link rel=preload> to <head>: the served section never
  // contains its own hint. Pairing must follow the rendered srcSet, not the
  // section subtree.
  function hoistHeroLink(html) {
    const link = html.match(/<link\b[^>]*>/)?.[0];
    if (!link) {
      throw new Error('fixture has no hero preload link to hoist');
    }
    return String(html)
      .replace(link, '')
      .replace('<html>', `<html><head>${link}</head>`);
  }

  it('pairs a head-hoisted hero preload with its section picture', () => {
    const html = hoistHeroLink(
      labHtml({ arm: 'pilot', generationId: 'e'.repeat(64), tiers: unitTiers })
    );
    expect(assertServedAgreement(html, { arm: 'pilot' })).toEqual([]);
  });

  it('still fails a hoisted link whose srcset drifts from the picture', () => {
    const html = hoistHeroLink(
      labHtml({ arm: 'pilot', generationId: 'e'.repeat(64), tiers: unitTiers })
    );
    const drifted = html.replace('a.avif 48w', 'a.avif 999w');
    expect(
      assertServedAgreement(drifted, { arm: 'pilot' }).length
    ).toBeGreaterThan(0);
  });

  it('catches a hero picture mis-mounted outside the hero slot', () => {
    // A hero-kind picture under a foreign slot must pair, not slip past
    // the slot filter: pairing is by binding identity, not slot name.
    const html = labHtml({
      arm: 'pilot',
      generationId: 'e'.repeat(64),
      tiers: unitTiers,
    }).replaceAll(
      'data-pilot-lab-slot="mobile-hero-slide-0"',
      'data-pilot-lab-slot="header-logo"'
    );
    expect(assertServedAgreement(html, { arm: 'pilot' })).toEqual([]);
    const unlinked = html.replace(/<link\b[^>]*>/, '');
    expect(
      assertServedAgreement(unlinked, { arm: 'pilot' }).join('\n')
    ).toMatch(/has no preload link/);
  });

  it('still fails a mounted hero with no preload link anywhere', () => {
    const html = labHtml({
      arm: 'pilot',
      generationId: 'e'.repeat(64),
      tiers: unitTiers,
    });
    const unlinked = html.replace(/<link\b[^>]*>/, '');
    expect(
      assertServedAgreement(unlinked, { arm: 'pilot' }).join('\n')
    ).toMatch(/has no preload link/);
  });

  it('accepts same-origin absolute staged URLs on a store control card', async () => {
    const fixture = await setupOfflineAssets([
      {
        assetId: 'card-a',
        generationId: 'c'.repeat(64),
        ladder: [384, 768, 1280],
        role: 'product',
        slot: 'product-card',
        url: 'https://cdn.example.com/media/card-a.png',
      },
    ]);
    const [card] = fixture.assets;
    const mount = mountFor(card);
    const server = createServer((req, res) => {
      const urlPath = req.url ?? '';
      if (urlPath.startsWith('/pilot-lab/store/')) {
        const origin = `http://${req.headers.host}`;
        const absolute = `${origin}${card.stagedOriginal}`;
        const body = `<!doctype html><html><head></head><body><main data-pilot-lab-arm="control"><section data-pilot-lab-slot="product-card" data-pilot-lab-binding="${mount.binding}"><div data-pilot-lab-selected-card="true"><img alt="lab card" fetchpriority="high" loading="eager" sizes="(max-width: 640px) 100vw, 50vw" src="${absolute}?w=640&q=75" srcset="${absolute}?w=640&q=75 640w, ${absolute}?w=750&q=75 750w"/></div></section></main></body></html>`;
        res.writeHead(200, { 'content-type': 'text/html' }).end(body);
        return;
      }
      if (urlPath.startsWith('/__pilot/')) {
        serveStaged(res, fixture.publicDir, urlPath).catch(() =>
          res.writeHead(500).end('error')
        );
        return;
      }
      res.writeHead(404).end('nope');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const report = await fetchServedAgreement(origin, {
        arms: ['control'],
        expectedBindings: [mount.binding],
        expectedMounts: [mount],
        pages: [
          {
            bindings: [mount.binding],
            mounts: [mount],
            path: '/pilot-lab/store/labstore',
            surface: 'store',
          },
        ],
        publicDir: fixture.publicDir,
      });
      expect(report.failures).toEqual([]);
      expect(report.ok).toBe(true);
      for (const gate of ['mount-coverage', 'descriptors', 'response-bytes']) {
        expect(
          report.checks.some(
            (check) =>
              check.name === `served:store:labstore:control:${gate}` && check.ok
          )
        ).toBe(true);
      }
      expect(report.coverage[0].mounted).toEqual([mount.binding]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
