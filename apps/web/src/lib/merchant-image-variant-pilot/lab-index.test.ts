import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PILOT_RECIPE_ID } from '@/schemas/merchant-image-variant-pilot';
import { buildLabIndex, lookupPilotTiers } from './lab-index';
import {
  GENERATION_ID,
  MERCHANT,
  SOURCE,
  setupLab,
} from './lab-index-fixtures';

describe('buildLabIndex', () => {
  it('activates an accepted binding and reports missing-acceptance when omitted', async () => {
    const lab = await setupLab();
    try {
      const acceptance = {
        assetId: 'logo-1',
        generationId: GENERATION_ID,
        merchantId: MERCHANT,
        note: 'Reviewed and approved.',
        originalUrl: 'https://cdn.example.com/media/logo.png',
        outputHashes: lab.tiers.map((tier) => tier.sha256),
        qualities: lab.tiers.map((tier) => tier.quality),
        recipeId: PILOT_RECIPE_ID,
        reviewedAt: '2026-10-01T21:00:00.000Z',
        reviewer: 'pilot-owner',
        schemaVersion: 1,
        slotId: 'header-logo',
        sourceSha256: SOURCE,
        verdict: 'accepted',
      };
      const built = await buildLabIndex({
        acceptances: [acceptance],
        bindings: lab.bindings,
        outputRoot: lab.outputRoot,
      });
      expect(built.diagnostics).toEqual([]);
      expect(built.statuses[0]?.status).toBe('accepted');
      expect(lookupPilotTiers(built.index, lab.bindings[0])).toHaveLength(6);

      const unaccepted = await buildLabIndex({
        acceptances: [],
        bindings: lab.bindings,
        outputRoot: lab.outputRoot,
      });
      expect(unaccepted.statuses[0]?.status).toBe('missing-acceptance');
    } finally {
      await rm(join(lab.outputRoot, '..'), { force: true, recursive: true });
    }
  });
});
