import { describe, expect, it } from 'vitest';
import { buildMerchantReturnPolicy } from './build-seo-offer-policy-schema';
import type { MerchantTrustProfile } from './merchant-trust-profile-types';

const emptyProfile: MerchantTrustProfile = {
  socialLinks: {},
  derivedLinks: {},
};

const makeReturnProfile = (
  returnPolicy: NonNullable<MerchantTrustProfile['returnPolicy']>
): MerchantTrustProfile => ({
  ...emptyProfile,
  returnPolicy,
});

describe('buildMerchantReturnPolicy', () => {
  it('returns undefined when windowDays is missing, non-integer, or negative', () => {
    expect(buildMerchantReturnPolicy('NG', undefined)).toBeUndefined();
    expect(buildMerchantReturnPolicy('NG', emptyProfile)).toBeUndefined();
    expect(
      buildMerchantReturnPolicy(
        'NG',
        makeReturnProfile({ localRoute: '/returns', windowDays: -1 })
      )
    ).toBeUndefined();
    expect(
      buildMerchantReturnPolicy(
        'NG',
        makeReturnProfile({ localRoute: '/returns', windowDays: 1.5 })
      )
    ).toBeUndefined();
  });

  it('returns undefined when country cannot be normalized', () => {
    expect(
      buildMerchantReturnPolicy(
        'Atlantis',
        makeReturnProfile({ localRoute: '/returns', windowDays: 14 })
      )
    ).toBeUndefined();
  });

  it('normalizes country name to ISO 3166-1 alpha-2 code in return policy', () => {
    const policy = buildMerchantReturnPolicy(
      'Nigeria',
      makeReturnProfile({ localRoute: '/returns', windowDays: 14 })
    );
    expect(policy).toEqual(
      expect.objectContaining({
        applicableCountry: 'NG',
        returnPolicyCountry: 'NG',
      })
    );
  });

  it('returns MerchantReturnNotPermitted when windowDays is 0', () => {
    const policy = buildMerchantReturnPolicy(
      'NG',
      makeReturnProfile({ localRoute: '/returns', windowDays: 0 })
    );
    expect(policy).toEqual({
      '@type': 'MerchantReturnPolicy',
      applicableCountry: 'NG',
      returnPolicyCountry: 'NG',
      returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
    });
  });

  it('returns MerchantReturnFiniteReturnWindow with days, fees, and methods when windowDays > 0', () => {
    const policy = buildMerchantReturnPolicy(
      'NG',
      makeReturnProfile({
        localRoute: '/returns',
        windowDays: 14,
        returnMethod: 'mail',
        returnFees: 'free',
      })
    );
    expect(policy).toEqual({
      '@type': 'MerchantReturnPolicy',
      applicableCountry: 'NG',
      returnPolicyCountry: 'NG',
      returnPolicyCategory:
        'https://schema.org/MerchantReturnFiniteReturnWindow',
      merchantReturnDays: 14,
      returnMethod: 'https://schema.org/ReturnByMail',
      returnFees: 'https://schema.org/FreeReturn',
    });
  });

  it('maps carrier_dropoff and customer_pays accurately to Schema.org URLs', () => {
    const policy = buildMerchantReturnPolicy(
      'NG',
      makeReturnProfile({
        localRoute: '/returns',
        windowDays: 30,
        returnMethod: 'carrier_dropoff',
        returnFees: 'customer_pays',
      })
    );
    expect(policy).toEqual(
      expect.objectContaining({
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/ReturnShippingFees',
      })
    );
  });

  it('maps in_store and original_shipping_deducted accurately to Schema.org URLs', () => {
    const policy = buildMerchantReturnPolicy(
      'NG',
      makeReturnProfile({
        localRoute: '/returns',
        windowDays: 7,
        returnMethod: 'in_store',
        returnFees: 'original_shipping_deducted',
      })
    );
    expect(policy).toEqual(
      expect.objectContaining({
        returnMethod: 'https://schema.org/ReturnInStore',
        returnFees: 'https://schema.org/OriginalShippingFees',
      })
    );
  });

  it('omits returnMethod and returnFees when not provided', () => {
    const policy = buildMerchantReturnPolicy(
      'NG',
      makeReturnProfile({
        localRoute: '/returns',
        windowDays: 14,
      })
    );
    expect(policy).toEqual({
      '@type': 'MerchantReturnPolicy',
      applicableCountry: 'NG',
      returnPolicyCountry: 'NG',
      returnPolicyCategory:
        'https://schema.org/MerchantReturnFiniteReturnWindow',
      merchantReturnDays: 14,
    });
    expect(policy?.returnMethod).toBeUndefined();
    expect(policy?.returnFees).toBeUndefined();
  });
});
