import { describe, expect, it } from 'vitest';
import { buildOfferShippingDetails } from './product-schema-shipping';
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

describe('shipping', () => {
  it('recognizes country names and rejects inverted, negative, or fractional delivery ranges', () => {
    expect(
      buildOfferShippingDetails('Nigeria', 'NGN', {
        ...profile,
        shippingPolicy: { ...profile.shippingPolicy, regions: ['NG'] },
      })
    ).toMatchObject({
      shippingDestination: { addressCountry: 'NG' },
    });
    expect(
      buildOfferShippingDetails('NG', 'NGN', {
        ...profile,
        shippingPolicy: { ...profile.shippingPolicy, regions: ['Nigeria'] },
      })
    ).toBeDefined();
    expect(
      buildOfferShippingDetails('NG', 'NGN', {
        ...profile,
        shippingPolicy: {
          ...profile.shippingPolicy,
          handlingDaysMin: -1,
          handlingDaysMax: 2,
        },
      })
    ).toBeUndefined();
    expect(
      buildOfferShippingDetails('NG', 'NGN', {
        ...profile,
        shippingPolicy: {
          ...profile.shippingPolicy,
          transitDaysMin: 1.5,
          transitDaysMax: 3,
        },
      })
    ).toBeUndefined();
    expect(
      buildOfferShippingDetails('NG', 'NGN', {
        ...profile,
        shippingPolicy: {
          ...profile.shippingPolicy,
          handlingDaysMin: 3,
          handlingDaysMax: 1,
        },
      })
    ).toBeUndefined();
    expect(
      buildOfferShippingDetails('NG', 'NGN', {
        ...profile,
        shippingPolicy: {
          ...profile.shippingPolicy,
          transitDaysMin: 8,
          transitDaysMax: 2,
        },
      })
    ).toBeUndefined();
  });
  it('publishes an explicitly configured free country-wide rate and delivery times', () => {
    expect(buildOfferShippingDetails('NG', ' ngn ', profile)).toMatchObject({
      shippingRate: { value: 0, currency: 'NGN' },
      deliveryTime: { transitTime: { maxValue: 7 } },
    });
    expect(buildOfferShippingDetails('NG', '', profile)).toBeUndefined();
    expect(buildOfferShippingDetails('NG', 'NAIRA', profile)).toBeUndefined();
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
});
