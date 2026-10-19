import {
  copyFile,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runOfflinePreflight } from './merchant-image-pilot-preflight-offline.mjs';
import {
  MERCHANT,
  offlineOptions,
  RECIPE,
  setupOffline,
} from './merchant-image-pilot-preflight-offline-fixtures.mjs';

describe('preflight offline gate: acceptance and recipe', () => {
  it('rejects oversized inventory and acceptance files before parsing', async () => {
    // A corrupt or swapped-in giant file rejects on size instead of
    // exhausting the gate ahead of the 20-record cap and shape checks.
    const bulky = Buffer.alloc(1024 * 1024 + 1, 120);
    const overInventory = await setupOffline();
    await writeFile(overInventory.inventoryPath, bulky);
    const inventoryReport = await runOfflinePreflight(
      offlineOptions(overInventory)
    );
    expect(inventoryReport.ok).toBe(false);
    expect(inventoryReport.failures.join('\n')).toMatch(
      /inventory-parse.*byte budget/
    );
    const overAcceptances = await setupOffline();
    await writeFile(overAcceptances.acceptancesPath, bulky);
    const acceptancesReport = await runOfflinePreflight(
      offlineOptions(overAcceptances)
    );
    expect(acceptancesReport.ok).toBe(false);
    expect(acceptancesReport.failures.join('\n')).toMatch(
      /acceptances-parse.*byte budget/
    );
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
        qualities: fixture.tiers.map((tier) => tier.quality),
        originalUrl: 'https://cdn.example.com/media/logo-a.png',
        recipeId: RECIPE,
        reviewedAt: '2026-10-01T21:00:00.000Z',
        reviewer: 'pilot-owner',
        schemaVersion: 1,
        slotId: 'header-logo',
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

  it('rejects an acceptance whose slot moved in the inventory', async () => {
    // Mirror of the route matcher: the reviewed slot binds the visual
    // verdict, so a binding moved to another slot needs a new review.
    const fixture = await setupOffline();
    const acceptances = JSON.parse(
      await readFile(fixture.acceptancesPath, 'utf8')
    );
    acceptances[0].slotId = 'product-card';
    await writeFile(fixture.acceptancesPath, JSON.stringify(acceptances));
    const moved = await runOfflinePreflight(offlineOptions(fixture));
    expect(moved.ok).toBe(false);
    expect(moved.failures.join('\n')).toMatch(/slot differs from inventory/);
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

  it('pins offline-verified staged digests for the served phase', async () => {
    const fixture = await setupOffline();
    const report = await runOfflinePreflight(offlineOptions(fixture));
    expect(report.ok).toBe(true);
    // Manifest tier hashes plus the validated inventory source hash,
    // keyed by served path: the served response-bytes gate compares
    // both copies against these instead of against each other.
    const [only] = fixture.assets;
    const expected = Object.fromEntries(
      fixture.tiers.map((tier) => [
        `/__pilot/${fixture.generationId}/${tier.path}`,
        tier.sha256,
      ])
    );
    expected[only.stagedOriginal] = only.sourceSha;
    // Plus the committed filler pins (the PIN, not the disk digest):
    // the fail-closed fillers gate verifies the staged bytes against
    // the boot gate's pins and records those.
    const { loadCommittedFillerPins } = await import(
      './merchant-image-pilot-preflight-offline-staged.mjs'
    );
    const pins = await loadCommittedFillerPins();
    for (const [name, pin] of Object.entries(pins)) {
      expected[`/__pilot/fillers/${name}`] = pin;
    }
    expect(report.stagedHashes).toEqual(expected);
  });
});
