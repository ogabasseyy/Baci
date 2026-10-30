import { IMEI_SERVICE_TIERS } from '@baci/shared/imei';
import { describe, expect, it } from 'vitest';
import replacement from './fixtures/petrock-replacement-1966-20261030.json';
import simlock from './fixtures/petrock-simlock-716-20261030.json';
import { inspectPetrockInfoCandidateReplay } from './petrock-info-replay-review';
import { parsePetrockReplay } from './petrock-parser';

describe('additional captured supplier output', () => {
  it('preserves captured SIMLock Status without inventing the absent model code', () => {
    expect(IMEI_SERVICE_TIERS.simLock.checksIncluded).toEqual([
      'device',
      'simLock',
    ]);
    expect(parsePetrockReplay(simlock.replay)).toMatchObject({
      device: 'IPHONE 17 PRO MAX SILVER-JPN 512GB',
      modelNumber: '',
      simLock: 'Unlocked',
      warranty: 'Limited Warranty',
      blacklistStatus: 'Unknown',
    });
  });

  it('keeps a replacement-device boolean distinct from replacement history', () => {
    const parsed = parsePetrockReplay(replacement.replay);
    expect(parsed.modelNumber).toBe('');
    expect(parsed.replacementHistory).toBeUndefined();
    const review = inspectPetrockInfoCandidateReplay(
      'replacementStatus',
      replacement
    );
    expect(review.fixtureVerified).toBe(false);
    expect(review.missingFields).toEqual(['modelNumber', 'replacementHistory']);
    expect(review.blockers).toContain('promised_fields_missing');
  });

  it.each([
    simlock,
    replacement,
  ])('sanitizes product $productId captured data', (capture) => {
    expect(JSON.stringify(capture)).not.toMatch(/\d{15}/);
    expect(capture.replay).not.toMatch(
      /IMEI|Serial Number|order_uuid|reference_id|Bearer /i
    );
  });
});
