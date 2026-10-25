import { PETROCK_DARK_IMEI_SERVICE_TIERS } from '@baci/shared/imei';
import { describe, expect, it } from 'vitest';
import { PETROCK_INFO_TIER_CANDIDATES } from './petrock-info-tier-candidates';

describe('PETROCK_INFO_TIER_CANDIDATES', () => {
  it('does not bind unavailable or semantically different products', () => {
    for (const key of [
      'refurbishedStatus',
      'macPhotoReport',
      'japanRakuten',
      'japanNetwork',
    ] as const) {
      expect(PETROCK_INFO_TIER_CANDIDATES[key].productId).toBeNull();
    }
    expect(PETROCK_INFO_TIER_CANDIDATES.japanDocomo.productId).toBe('732');
    expect(PETROCK_INFO_TIER_CANDIDATES.japanSoftbank.productId).toBe('733');
  });

  it('records every dark Phase 3 tier server-side without launch-enabling it', () => {
    expect(Object.keys(PETROCK_INFO_TIER_CANDIDATES).sort()).toEqual(
      [...PETROCK_DARK_IMEI_SERVICE_TIERS].sort()
    );

    for (const candidate of Object.values(PETROCK_INFO_TIER_CANDIDATES)) {
      expect(candidate.fixtureVerified).toBe(false);
      if (candidate.productId) {
        expect(candidate.productId).toMatch(/^\d+$/);
        expect(candidate.unavailableReason).toBeNull();
      } else {
        expect(candidate.unavailableReason).toBeTruthy();
      }
    }
  });

  it('uses the current machine field rather than the Mac display label', () => {
    expect(PETROCK_INFO_TIER_CANDIDATES.macInfo.orderFieldName).toBe('IMEI');
  });
});

it('does not equate KG enrollment, sales country or unlock eligibility with other promised fields', () => {
  for (const key of [
    'knoxEnrollment',
    'samsungSoldBy',
    'xfinityFinance',
  ] as const) {
    expect(PETROCK_INFO_TIER_CANDIDATES[key].productId).toBeNull();
    expect(PETROCK_INFO_TIER_CANDIDATES[key].unavailableReason).toBeTruthy();
  }
  expect(PETROCK_INFO_TIER_CANDIDATES.verizonFinance.productId).toBe('1959');
  expect(PETROCK_INFO_TIER_CANDIDATES.verizonFinance.costUsdBaseline).toBe(
    0.05
  );
});
