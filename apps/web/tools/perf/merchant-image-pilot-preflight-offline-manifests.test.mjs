import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runOfflinePreflight } from './merchant-image-pilot-preflight-offline.mjs';
import {
  MERCHANT,
  offlineOptions,
  setupOffline,
  setupOfflineAssets,
} from './merchant-image-pilot-preflight-offline-fixtures.mjs';

describe('preflight offline gate: manifests and staged bytes', () => {
  it('accepts verified manifests, staged bytes, and decoded dimensions', async () => {
    const fixture = await setupOffline();
    const report = await runOfflinePreflight(offlineOptions(fixture));
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    expect(
      report.checks.some((check) => check.name === 'binding:logo-a:tiers')
    ).toBe(true);
  });

  it('pins the inventory to the frozen sample matrix', async () => {
    const fixture = await setupOffline();
    const frozen = [`${MERCHANT}/logo-a/header-logo`];
    const samplePath = join(fixture.base, 'sample.json');
    await writeFile(samplePath, JSON.stringify(frozen));
    const pinned = await runOfflinePreflight(
      offlineOptions(fixture, { expectSample: samplePath })
    );
    expect(pinned.ok).toBe(true);
    // A deleted record (or merchant) shrinks the evidence: the reduced
    // inventory must fail against the frozen matrix, not report ok.
    await writeFile(
      samplePath,
      JSON.stringify([...frozen, `${MERCHANT}/logo-b/header-logo`])
    );
    const shrunk = await runOfflinePreflight(
      offlineOptions(fixture, { expectSample: samplePath })
    );
    expect(shrunk.ok).toBe(false);
    expect(shrunk.failures.join('\n')).toMatch(
      /sample bindings missing from inventory/
    );
    // Growth without a matrix update fails too: the certified sample is
    // exactly the frozen set.
    const grown = await setupOfflineAssets([
      {
        assetId: 'logo-a',
        ladder: [96, 192, 384],
        role: 'logo',
        slot: 'header-logo',
        url: 'https://cdn.example.com/media/logo-a.png',
      },
      {
        assetId: 'logo-b',
        ladder: [96, 192, 384],
        role: 'logo',
        slot: 'footer-logo',
        url: 'https://cdn.example.com/media/logo-b.png',
      },
    ]);
    const grownSample = join(grown.base, 'sample.json');
    await writeFile(grownSample, JSON.stringify(frozen));
    const extra = await runOfflinePreflight(
      offlineOptions(grown, { expectSample: grownSample })
    );
    expect(extra.ok).toBe(false);
    expect(extra.failures.join('\n')).toMatch(
      /inventory bindings outside the frozen sample/
    );
    // A malformed pin (empty matrix) fails instead of certifying nothing.
    await writeFile(samplePath, JSON.stringify([]));
    const empty = await runOfflinePreflight(
      offlineOptions(fixture, { expectSample: samplePath })
    );
    expect(empty.ok).toBe(false);
  });

  it('carries the validated inventory snapshot for the served phase', async () => {
    // The served gate reuses this snapshot instead of rereading the
    // file, so a deleted or swapped inventory between phases fails
    // closed instead of silently emptying the route matrix.
    const fixture = await setupOffline();
    const report = await runOfflinePreflight(offlineOptions(fixture));
    expect(report.ok).toBe(true);
    expect(report.inventory).toEqual(
      JSON.parse(await readFile(fixture.inventoryPath, 'utf8'))
    );
  });

  it('refuses an unpinned run: no sample pin, no green preflight', async () => {
    const fixture = await setupOffline();
    const unpinned = await runOfflinePreflight(
      offlineOptions(fixture, { expectSample: null })
    );
    expect(unpinned.ok).toBe(false);
    expect(unpinned.failures.join('\n')).toMatch(/sample pin is required/);
    const missing = await runOfflinePreflight({
      ...offlineOptions(fixture),
      expectSample: undefined,
    });
    expect(missing.ok).toBe(false);
  });

  it('rejects orphan acceptances for bindings outside the inventory', async () => {
    const fixture = await setupOffline();
    const acceptances = JSON.parse(
      await readFile(fixture.acceptancesPath, 'utf8')
    );
    acceptances.push({
      ...acceptances[0],
      assetId: 'logo-ghost',
    });
    await writeFile(fixture.acceptancesPath, JSON.stringify(acceptances));
    const report = await runOfflinePreflight(offlineOptions(fixture));
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(
      /acceptances without inventory records/
    );
  });

  it('rejects a valid generation copied under another directory ID', async () => {
    const fixture = await setupOffline();
    // Every hash inside still verifies; only the directory identity is
    // wrong. The runtime rejects this as binding-mismatch, so offline
    // preflight must fail too instead of writing mounts for it.
    const renamed = 'd'.repeat(64);
    await mkdir(join(fixture.outputRoot, 'generations', renamed), {
      recursive: true,
    });
    for (const file of ['manifest.json', ...fixture.tiers.map((t) => t.path)]) {
      await copyFile(
        join(fixture.outputRoot, 'generations', fixture.generationId, file),
        join(fixture.outputRoot, 'generations', renamed, file)
      );
    }
    const acceptances = JSON.parse(
      await readFile(fixture.acceptancesPath, 'utf8')
    );
    acceptances[0].generationId = renamed;
    await writeFile(fixture.acceptancesPath, JSON.stringify(acceptances));
    const report = await runOfflinePreflight(offlineOptions(fixture));
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/not the recipe output/);
  });

  it('rejects a retargeted inventory URL the acceptance never reviewed', async () => {
    const fixture = await setupOffline();
    const records = JSON.parse(await readFile(fixture.inventoryPath, 'utf8'));
    records[0].url = 'https://cdn.example.com/media/logo-retargeted.png';
    await writeFile(fixture.inventoryPath, JSON.stringify(records));
    const report = await runOfflinePreflight(offlineOptions(fixture));
    expect(report.ok).toBe(false);
    expect(report.failures.join('\n')).toMatch(/original URL changed/);
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
});
