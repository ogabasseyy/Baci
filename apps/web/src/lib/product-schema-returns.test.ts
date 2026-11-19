import { describe, expect, it } from 'vitest';
import { buildMerchantReturnPolicyFromTrustProfile } from './product-schema-returns';
import type { MerchantTrustProfile } from './storefront-trust/merchant-trust-profile-types';

const profile = {
  socialLinks: {},
  derivedLinks: {},
  shippingPolicy: {
    localRoute: '/shipping',
    regions: ['NG'],
    shippingFeeType: 'free',
    handlingDaysMin: 0,
    handlingDaysMax: 2,
    transitDaysMin: 1,
    transitDaysMax: 7,
  },
} satisfies MerchantTrustProfile;

describe('returns', () => {
  it('does not invent return fees or methods when only a window is known', () => {
    const policy = buildMerchantReturnPolicyFromTrustProfile('NG', {
      ...profile,
      returnPolicy: { localRoute: '/returns', windowDays: 7 },
    });
    expect(policy?.merchantReturnDays).toBe(7);
    expect(policy).not.toHaveProperty('returnFees');
    expect(policy).not.toHaveProperty('returnMethod');
    expect(
      buildMerchantReturnPolicyFromTrustProfile('Nigeria', {
        ...profile,
        returnPolicy: { localRoute: '/returns', windowDays: 7 },
      })
    ).toMatchObject({
      applicableCountry: 'NG',
      returnPolicyCountry: 'NG',
    });
    expect(
      buildMerchantReturnPolicyFromTrustProfile('Atlantis', {
        ...profile,
        returnPolicy: { localRoute: '/returns', windowDays: 7 },
      })
    ).toBeUndefined();
    expect(buildMerchantReturnPolicyFromTrustProfile('NG')).toBeUndefined();
  });
});
