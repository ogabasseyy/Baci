import { writeFile } from 'node:fs/promises';
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

describe('buildLabIndex manifests', () => {
  let lab: Awaited<ReturnType<typeof setupLab>>;

  beforeEach(async () => {
    lab = await setupLab();
  });

  it('accepts a verified manifest, acceptance, and output hashes', async () => {
    const { index, statuses } = await buildLabIndex({
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
          slotId: 'header-logo',
          sourceSha256: SOURCE,
          verdict: 'accepted',
        },
      ],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.status).toBe('accepted');
    expect(Object.isFrozen(index)).toBe(true);
    const tiers = lookupPilotTiers(index, {
      assetId: 'logo-1',
      merchantId: MERCHANT,
      role: 'logo',
      sourceSha256: SOURCE,
    });
    expect(tiers).toHaveLength(6);
  });

  it('rejects an oversized otherwise valid manifest before activating its tiers', async () => {
    await writeFile(
      join(lab.generationDir, 'manifest.json'),
      `${JSON.stringify(lab.manifest)}${' '.repeat(256 * 1024)}`
    );
    const { index, statuses } = await buildLabIndex({
      acceptances: [
        {
          assetId: 'logo-1',
          generationId: GENERATION_ID,
          merchantId: MERCHANT,
          note: 'Reviewed',
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
    expect(statuses[0]?.status).not.toBe('accepted');
    expect(Object.keys(index.entries)).toHaveLength(0);
  });

  it('rejects a retargeted original URL with everything else unchanged', async () => {
    const retargeted = lab.bindings.map((binding) => ({
      ...binding,
      originalUrl: 'https://cdn.example.com/media/logo-retargeted.png',
    }));
    const { index, statuses } = await buildLabIndex({
      acceptances: [
        {
          assetId: 'logo-1',
          generationId: GENERATION_ID,
          merchantId: MERCHANT,
          note: 'Reviewed',
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
      bindings: retargeted,
      outputRoot: lab.outputRoot,
    });
    expect(statuses[0]?.status).toBe('acceptance-mismatch');
    expect(statuses[0]?.detail).toMatch(/original URL changed/);
    expect(Object.keys(index.entries)).toHaveLength(0);
  });

  it('surfaces guarded dispositions explicitly', async () => {
    const guardedTiers = lab.tiers.map((tier) => ({
      ...tier,
      delivery: 'generated',
    }));
    const guarded = await setupLab({
      manifest: { tiers: guardedTiers },
    });
    const { index, statuses } = await buildLabIndex({
      acceptances: [
        {
          assetId: 'logo-1',
          generationId: GENERATION_ID,
          merchantId: MERCHANT,
          note: 'Lab review: legible, colors preserved.',
          outputHashes: guardedTiers.map((tier) => tier.sha256),
          qualities: guardedTiers.map((tier) => tier.quality),
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
      bindings: guarded.bindings,
      outputRoot: guarded.outputRoot,
    });
    expect(statuses[0]?.status).toBe('accepted');
    const tiers = lookupPilotTiers(index, {
      assetId: 'logo-1',
      merchantId: MERCHANT,
      role: 'logo',
      sourceSha256: SOURCE,
    });
    expect(tiers?.map((tier) => tier.delivery)).toEqual(
      Array(6).fill('generated')
    );
  });

  it('rejects a current-recipe manifest that omits delivery', async () => {
    // Delivery-less tiers are frozen r1 legacy only. Under the current
    // recipe the omission would skip every never-larger check, so the
    // lab refuses to activate instead of mapping to 'legacy'.
    const undelivered = lab.tiers.map((tier) => {
      const { delivery: _delivery, ...rest } = tier;
      void _delivery;
      return rest;
    });
    const fixture = await setupLab({ manifest: { tiers: undelivered } });
    const { index, statuses } = await buildLabIndex({
      acceptances: [
        {
          assetId: 'logo-1',
          generationId: GENERATION_ID,
          merchantId: MERCHANT,
          note: 'Lab review: legible, colors preserved.',
          outputHashes: undelivered.map((tier) => tier.sha256),
          qualities: undelivered.map((tier) => tier.quality),
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
      bindings: fixture.bindings,
      outputRoot: fixture.outputRoot,
    });
    expect(statuses[0]?.status).toBe('invalid-manifest');
    expect(
      lookupPilotTiers(index, {
        assetId: 'logo-1',
        merchantId: MERCHANT,
        role: 'logo',
        sourceSha256: SOURCE,
      })
    ).toBeNull();
  });

  it('rejects a guarded manifest whose disposition violates the source bytes', async () => {
    const violating = lab.tiers.map((tier, position) =>
      position === 0 ? { ...tier, bytes: 1235, delivery: 'generated' } : tier
    );
    const fixture = await setupLab({ manifest: { tiers: violating } });
    const { statuses } = await buildLabIndex({
      acceptances: [
        {
          assetId: 'logo-1',
          generationId: GENERATION_ID,
          merchantId: MERCHANT,
          note: 'Lab review: legible, colors preserved.',
          outputHashes: violating.map((tier) => tier.sha256),
          qualities: violating.map((tier) => tier.quality),
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
      bindings: fixture.bindings,
      outputRoot: fixture.outputRoot,
    });
    expect(statuses[0]?.status).toBe('invalid-manifest');
  });
});
