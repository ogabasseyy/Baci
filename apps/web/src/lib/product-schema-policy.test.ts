import { describe, expect, it } from 'vitest';
import {
  buildMerchantReturnPolicyFromTrustProfile,
  buildOfferShippingDetails,
} from './product-schema-policy';
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
describe('product schema policies', () => {
  it('publishes an explicitly configured free country-wide rate and delivery times', () => {
    expect(buildOfferShippingDetails('NG', 'NGN', profile)).toMatchObject({
      shippingRate: { value: 0, currency: 'NGN' },
      deliveryTime: { transitTime: { maxValue: 7 } },
    });
  });
  it('omits unquoted calculated rates and restricted regional coverage', () => {
    expect(
      buildOfferShippingDetails('NG', 'NGN', {
        ...profile,
        shippingPolicy: {
          ...profile.shippingPolicy,
          shippingFeeType: 'calculated',
        },
      })
    ).toBeUndefined();
    expect(
      buildOfferShippingDetails('NG', 'NGN', {
        ...profile,
        shippingPolicy: { ...profile.shippingPolicy, regions: ['Lagos'] },
      })
    ).toBeUndefined();
    expect(buildOfferShippingDetails('NG', 'NGN')).toBeUndefined();
  });
  it('does not invent return fees or methods when only a window is known', () => {
    const policy = buildMerchantReturnPolicyFromTrustProfile('NG', {
      ...profile,
      returnPolicy: { localRoute: '/returns', windowDays: 7 },
    });
    expect(policy?.merchantReturnDays).toBe(7);
    expect(policy).not.toHaveProperty('returnFees');
    expect(policy).not.toHaveProperty('returnMethod');
    expect(buildMerchantReturnPolicyFromTrustProfile('NG')).toBeUndefined();
  });
});
