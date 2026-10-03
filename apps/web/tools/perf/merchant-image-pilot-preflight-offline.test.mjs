import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readFile,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { RECIPE_ID } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { runOfflinePreflight } from './merchant-image-pilot-preflight-offline.mjs';

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
    // 2000px-wide source: every role ladder fits without upscaling (the
    // manifest contract rejects upscaled claims), and the 4:1 aspect keeps
    // rung heights exact.
    await copyFile(
      join(GENERATOR_FIXTURES, 'wide-2000x500.png'),
      join(inputRoot, sourcePath)
    );
    const snapshot = await readFile(join(inputRoot, sourcePath));
    const sourceSha = sha256(snapshot);
    const sourceMeta = await sharp(snapshot).metadata();
    const generationDir = join(outputRoot, 'generations', asset.generationId);
    await mkdir(generationDir, { recursive: true });
    // Real encodings on the genuine role ladder so descriptor checks verify
    // actual decoded dimensions, not string shapes. Aspect-preserving
    // downscale; claimed geometry is read back from the decoded bytes.
    const tiers = [];
    for (const width of asset.ladder) {
      for (const format of ['avif', 'webp']) {
        const bytes = await sharp(snapshot)
          .resize(Math.min(width, sourceMeta.width))
          .toFormat(format)
          .toBuffer();
        const decoded = await sharp(bytes).metadata();
        const hash = sha256(bytes);
        const fileName = `${hash}.${format}`;
        await writeFile(join(generationDir, fileName), bytes);
        tiers.push({
          actualWidth: decoded.width,
          bytes: bytes.length,
          contentType: `image/${format}`,
          // png source: capped rungs generate, larger rungs take the
          // explicit over-source exception.
          delivery:
            bytes.length <= snapshot.length
              ? 'generated'
              : 'generated-over-source',
          format,
          height: decoded.height,
          path: fileName,
          quality: 70,
          requestedWidth: width,
          sha256: hash,
          width: decoded.width,
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
          orientedHeight: sourceMeta.height,
          orientedWidth: sourceMeta.width,
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

function _labHtml({ arm, generationId, tiers }) {
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

function _srcSetFor(asset, generationId, format) {
  return asset.tiers
    .filter((tier) => tier.format === format)
    .map((tier) => `/__pilot/${generationId}/${tier.path} ${tier.width}w`)
    .join(', ');
}

describe('preflight offline gate', () => {
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
    // The manifest contract binds encoded geometry to the source ladder,
    // so the forged width is rejected at parse time, before byte decode.
    expect(report.failures.join('\n')).toMatch(/dimension|decoded|rung width/i);
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
});
