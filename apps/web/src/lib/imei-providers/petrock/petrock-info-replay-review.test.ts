import {
  IMEI_SERVICE_TIERS,
  PETROCK_DARK_IMEI_SERVICE_TIERS,
  PUBLIC_IMEI_SERVICE_TIERS,
} from '@baci/shared/imei';
import { describe, expect, it } from 'vitest';
import { resolveImeiProviderBinding } from '../tier-bindings';
import { inspectPetrockInfoCandidateReplay } from './petrock-info-replay-review';
import { PETROCK_INFO_TIER_CANDIDATES } from './petrock-info-tier-candidates';

describe('offline candidate replay review', () => {
  it.each(
    PETROCK_DARK_IMEI_SERVICE_TIERS
  )('%s remains hidden and unroutable with all rollout switches enabled', (tierKey) => {
    const tier = IMEI_SERVICE_TIERS[tierKey];
    expect(PUBLIC_IMEI_SERVICE_TIERS).not.toContain(tierKey);
    for (const deviceCategory of tier.deviceCategories) {
      expect(
        resolveImeiProviderBinding({
          tier,
          tierKey,
          deviceCategory,
          clientSupportsAsync: true,
          petrockEnabled: true,
          petrockEnabledTiers: new Set(PETROCK_DARK_IMEI_SERVICE_TIERS),
        })
      ).toBeNull();
    }
  });

  it.each(
    PETROCK_DARK_IMEI_SERVICE_TIERS
  )('%s cannot borrow the captured Apple model/FMI response as evidence', (tierKey) => {
    const review = inspectPetrockInfoCandidateReplay(tierKey, {
      productId: '1954',
      status: 'success',
      replay:
        'Model: iPhone 17 Pro Max 512GB Silver<br>Color: Silver<br>Find My iPhone: ON',
    });
    expect(review.fixtureVerified).toBe(false);
    expect(review.blockers).toContain('product_mismatch');
    expect(review.missingFields).toEqual(
      IMEI_SERVICE_TIERS[tierKey].checksIncluded
    );
  });

  it.each(
    PETROCK_DARK_IMEI_SERVICE_TIERS
  )('%s reports all missing promises for an empty replay', (tierKey) => {
    const review = inspectPetrockInfoCandidateReplay(tierKey, {
      productId: PETROCK_INFO_TIER_CANDIDATES[tierKey].productId ?? '',
      status: 'success',
      replay: '',
    });
    expect(review.missingFields).toEqual(
      IMEI_SERVICE_TIERS[tierKey].checksIncluded
    );
    expect(review.blockers).toContain('reviewed_capture_required');
  });

  it('inspects synthetic field coverage without promoting it to verified evidence', () => {
    const review = inspectPetrockInfoCandidateReplay('oneplusPremium', {
      productId: '738',
      status: 'success',
      replay: 'Model: OnePlus 13<br>Model Number: CPH2649',
    });
    expect(review.missingFields).toEqual([]);
    expect(review.blockers).toEqual(['reviewed_capture_required']);
    expect(review.fixtureVerified).toBe(false);
  });

  it.each([
    'in-process',
    'rejected',
  ])('does not credit fields from a %s order', (status) => {
    const review = inspectPetrockInfoCandidateReplay('oneplusPremium', {
      productId: '738',
      status,
      replay: 'Model: OnePlus 13<br>Model Number: CPH2649',
    });
    expect(review.blockers).toContain('completion_required');
    expect(review.missingFields).toEqual(
      IMEI_SERVICE_TIERS.oneplusPremium.checksIncluded
    );
  });

  it('does not count placeholder fields as covered', () => {
    const review = inspectPetrockInfoCandidateReplay('oneplusPremium', {
      productId: '738',
      status: 'success',
      replay: 'Model: Unknown<br>Model Number: N/A',
    });
    expect(review.missingFields).toEqual(
      IMEI_SERVICE_TIERS.oneplusPremium.checksIncluded
    );
  });
});
