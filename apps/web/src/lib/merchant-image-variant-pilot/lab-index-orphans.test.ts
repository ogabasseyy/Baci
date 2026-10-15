import { describe, expect, it } from 'vitest';
import { PILOT_RECIPE_ID } from '@/schemas/merchant-image-variant-pilot';
import { buildLabIndex } from './lab-index';
import {
  GENERATION_ID,
  MERCHANT,
  SOURCE,
  setupLab,
} from './lab-index-fixtures';

const REMOVED_MERCHANT = 'de968340-de02-4aa8-95f9-9d5f7d2b1f20';

describe('buildLabIndex orphan acceptances', () => {
  it('reports acceptances with no inventory binding as diagnostics', async () => {
    const lab = await setupLab();
    const base = {
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
    // The merchant/asset was removed from inventory but its review record
    // lingers in acceptances.json: the binding loop would otherwise visit
    // only current bindings and silently narrow the sample.
    const result = await buildLabIndex({
      acceptances: [
        base,
        { ...base, assetId: 'gone-1', merchantId: REMOVED_MERCHANT },
      ],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    expect(result.statuses[0]?.status).toBe('accepted');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatch(
      /acceptances without inventory records/
    );
    expect(result.diagnostics[0]).toContain(`${REMOVED_MERCHANT}/gone-1`);
  });

  it('stays silent when every acceptance has a binding', async () => {
    const lab = await setupLab();
    const result = await buildLabIndex({
      acceptances: [],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    expect(result.diagnostics).toHaveLength(0);
    expect(result.statuses[0]?.status).toBe('missing-acceptance');
  });
});
