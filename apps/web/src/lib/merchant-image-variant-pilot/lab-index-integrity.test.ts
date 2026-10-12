import { cp, mkdir, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { PILOT_RECIPE_ID } from '@/schemas/merchant-image-variant-pilot';
import { buildLabIndex, lookupPilotTiers } from './lab-index';
import {
  GENERATION_ID,
  MERCHANT,
  SOURCE,
  setupLab,
} from './lab-index-fixtures';

describe('buildLabIndex integrity', () => {
  let lab: Awaited<ReturnType<typeof setupLab>>;

  beforeEach(async () => {
    lab = await setupLab();
  });

  it('rejects an acceptance whose slot moved in the bindings', async () => {
    // The reviewed slot binds the visual verdict: same merchant, asset,
    // generation, and bytes in another slot needs a new review.
    const { statuses } = await buildLabIndex({
      acceptances: [
        {
          assetId: 'logo-1',
          generationId: GENERATION_ID,
          merchantId: MERCHANT,
          note: 'Lab review: legible, colors preserved.',
          outputHashes: lab.tiers.map((tier) => tier.sha256),
          qualities: lab.tiers.map((tier) => tier.quality),
          originalUrl: 'https://cdn.example.com/media/logo.png',
          recipeId: PILOT_RECIPE_ID,
          reviewedAt: '2026-10-01T21:00:00.000Z',
          reviewer: 'pilot-owner',
          schemaVersion: 1,
          slotId: 'product-card',
          sourceSha256: SOURCE,
          verdict: 'accepted',
        },
      ],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    expect(statuses[0]?.status).toBe('acceptance-mismatch');
    expect(statuses[0]?.detail).toBe('slot changed');
  });

  it('rejects a symlinked generation entry before reading its manifest', async () => {
    // The entry carries a fully valid manifest — but from outside the
    // configured output tree, so confinement must reject it before the
    // loader accepts or stages a single byte.
    const outside = join(tmpdir(), `pilot-outside-${Date.now()}`);
    await mkdir(outside, { recursive: true });
    const moved = join(outside, 'generation');
    await rename(lab.generationDir, moved);
    await symlink(moved, lab.generationDir);
    const result = await buildLabIndex({
      acceptances: [
        {
          assetId: 'logo-1',
          generationId: GENERATION_ID,
          merchantId: MERCHANT,
          note: 'n',
          outputHashes: lab.tiers.map((tier) => tier.sha256),
          qualities: lab.tiers.map((tier) => tier.quality),
          originalUrl: 'https://cdn.example.com/media/logo.png',
          recipeId: PILOT_RECIPE_ID,
          reviewedAt: '2026-10-01T21:00:00.000Z',
          reviewer: 'pilot-owner',
          schemaVersion: 1,
          slotId: 'header-logo',
          sourceSha256: SOURCE,
          verdict: 'accepted',
        },
      ],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    expect(result.statuses[0]?.status).toBe('invalid-manifest');
    expect(result.statuses[0]?.detail).toMatch(/escapes the output root/);
    expect(Object.keys(result.index.entries)).toHaveLength(0);
  });

  it('rejects a copied generation served under a different id', async () => {
    const renamed = 'd'.repeat(64);
    await cp(lab.generationDir, join(lab.outputRoot, 'generations', renamed), {
      recursive: true,
    });
    const result = await buildLabIndex({
      acceptances: [
        {
          assetId: 'logo-1',
          generationId: renamed,
          merchantId: MERCHANT,
          note: 'n',
          outputHashes: lab.tiers.map((tier) => tier.sha256),
          qualities: lab.tiers.map((tier) => tier.quality),
          originalUrl: 'https://cdn.example.com/media/logo.png',
          recipeId: PILOT_RECIPE_ID,
          reviewedAt: '2026-10-01T21:00:00.000Z',
          reviewer: 'pilot-owner',
          schemaVersion: 1,
          slotId: 'header-logo',
          sourceSha256: SOURCE,
          verdict: 'accepted',
        },
      ],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    // Every hash inside still verifies, but the directory is not the
    // recipe output for this binding under the claimed id.
    expect(result.statuses[0]?.status).toBe('binding-mismatch');
  });

  it('refuses to activate conflicting duplicate acceptances in either order', async () => {
    const accepted = {
      assetId: 'logo-1',
      generationId: GENERATION_ID,
      merchantId: MERCHANT,
      note: 'n',
      outputHashes: lab.tiers.map((tier) => tier.sha256),
      qualities: lab.tiers.map((tier) => tier.quality),
      originalUrl: 'https://cdn.example.com/media/logo.png',
      recipeId: PILOT_RECIPE_ID,
      reviewedAt: '2026-10-01T21:00:00.000Z',
      reviewer: 'pilot-owner',
      schemaVersion: 1,
      slotId: 'header-logo',
      sourceSha256: SOURCE,
      verdict: 'accepted' as const,
    };
    const rejected = { ...accepted, verdict: 'rejected' as const };
    for (const acceptances of [
      [accepted, rejected],
      [rejected, accepted],
    ]) {
      const result = await buildLabIndex({
        acceptances,
        bindings: lab.bindings,
        outputRoot: lab.outputRoot,
      });
      expect(result.statuses[0]?.status).toBe('acceptance-mismatch');
      expect(result.statuses[0]?.detail).toMatch(/conflicting duplicate/);
      expect(
        lookupPilotTiers(result.index, {
          assetId: 'logo-1',
          merchantId: MERCHANT,
          role: 'logo',
          sourceSha256: SOURCE,
        })
      ).toBeNull();
      expect(
        result.diagnostics.some((entry) => /duplicate acceptances/.test(entry))
      ).toBe(true);
    }
  });

  it('treats exact duplicate acceptances as idempotent', async () => {
    const acceptance = {
      assetId: 'logo-1',
      generationId: GENERATION_ID,
      merchantId: MERCHANT,
      note: 'n',
      outputHashes: lab.tiers.map((tier) => tier.sha256),
      qualities: lab.tiers.map((tier) => tier.quality),
      originalUrl: 'https://cdn.example.com/media/logo.png',
      recipeId: PILOT_RECIPE_ID,
      reviewedAt: '2026-10-01T21:00:00.000Z',
      reviewer: 'pilot-owner',
      schemaVersion: 1,
      slotId: 'header-logo',
      sourceSha256: SOURCE,
      verdict: 'accepted' as const,
    };
    const result = await buildLabIndex({
      acceptances: [acceptance, { ...acceptance }],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    expect(result.statuses[0]?.status).toBe('accepted');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('treats swapped-hash duplicates as conflicting, not idempotent', async () => {
    const hashes = lab.tiers.map((tier) => tier.sha256);
    const base = {
      assetId: 'logo-1',
      generationId: GENERATION_ID,
      merchantId: MERCHANT,
      note: 'n',
      originalUrl: 'https://cdn.example.com/media/logo.png',
      recipeId: PILOT_RECIPE_ID,
      reviewedAt: '2026-10-01T21:00:00.000Z',
      reviewer: 'pilot-owner',
      schemaVersion: 1,
      slotId: 'header-logo',
      sourceSha256: SOURCE,
      verdict: 'accepted' as const,
    };
    // Same multiset, swapped positions: binding pins each hash to one
    // rung positionally, so these are conflicting verdicts. An
    // order-insensitive dedupe would silently drop the second.
    const qualities = lab.tiers.map((tier) => tier.quality);
    const result = await buildLabIndex({
      acceptances: [
        { ...base, outputHashes: hashes, qualities },
        { ...base, outputHashes: [...hashes].reverse(), qualities },
      ],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    expect(result.statuses[0]?.status).toBe('acceptance-mismatch');
    expect(result.statuses[0]?.detail).toMatch(/conflicting duplicate/);
    expect(
      result.diagnostics.some((entry) => /duplicate acceptances/.test(entry))
    ).toBe(true);
  });

  it('keeps malformed acceptances diagnosable instead of dropping them silently', async () => {
    const result = await buildLabIndex({
      acceptances: [{ assetId: 'logo-1', verdict: 'accepted' }],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    expect(result.statuses[0]?.status).toBe('missing-acceptance');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatch(/acceptance\[0\] invalid/);
  });
});
