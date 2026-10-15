import { describe, expect, it } from 'vitest';
import { PILOT_RECIPE_ID } from '@/schemas/merchant-image-variant-pilot';
import { buildLabIndex, lookupPilotTiers, selectPilotTier } from './lab-index';
import {
  GENERATION_ID,
  MERCHANT,
  SOURCE,
  setupLab,
} from './lab-index-fixtures';

describe('lookupPilotTiers and selectPilotTier', () => {
  it('binds lookups to the full identity and selects adequate tiers', async () => {
    const lab = await setupLab();
    const { index } = await buildLabIndex({
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
    // A rotated source hash no longer resolves.
    expect(
      lookupPilotTiers(index, {
        assetId: 'logo-1',
        merchantId: MERCHANT,
        role: 'logo',
        sourceSha256: 'f'.repeat(64),
      })
    ).toBeNull();
    const tiers = lookupPilotTiers(index, {
      assetId: 'logo-1',
      merchantId: MERCHANT,
      role: 'logo',
      sourceSha256: SOURCE,
    });
    expect(tiers).not.toBeNull();
    // Lookup is synchronous and I/O-free.
    expect(tiers instanceof Promise).toBe(false);
    const webp = selectPilotTier(tiers ?? [], {
      format: 'webp',
      requestedWidth: 40,
    });
    expect(webp?.width).toBe(48);
    // Beyond the ladder is out of coverage, not a silent upscale.
    expect(
      selectPilotTier(tiers ?? [], { format: 'webp', requestedWidth: 49 })
    ).toBeNull();
    expect(
      selectPilotTier(tiers ?? [], { format: 'avif', requestedWidth: 48 })
        ?.format
    ).toBe('avif');
  });
});
