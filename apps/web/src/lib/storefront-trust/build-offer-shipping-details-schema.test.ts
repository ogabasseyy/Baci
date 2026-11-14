import { describe, expect, it } from 'vitest';
import { buildOfferShippingDetails } from './build-offer-shipping-details-schema';
import type { MerchantTrustProfile } from './merchant-trust-profile-types';

const emptyProfile: MerchantTrustProfile = {
  socialLinks: {},
  derivedLinks: {},
};

const makeShippingProfile = (
  overrides?: Partial<NonNullable<MerchantTrustProfile['shippingPolicy']>>
): MerchantTrustProfile => ({
  ...emptyProfile,
  shippingPolicy: {
    localRoute: '/shipping',
    regions: ['NG'],
    shippingFeeType: 'free',
    handlingDaysMin: 0,
    handlingDaysMax: 1,
    transitDaysMin: 1,
    transitDaysMax: 3,
    ...overrides,
  },
});

describe('buildOfferShippingDetails', () => {
  it('returns undefined when country cannot be normalized', () => {
    expect(
      buildOfferShippingDetails('Atlantis', 'NGN', makeShippingProfile())
    ).toBeUndefined();
  });

  it('returns undefined if shipping is not free', () => {
    expect(
      buildOfferShippingDetails(
        'NG',
        'NGN',
        makeShippingProfile({ shippingFeeType: 'calculated' })
      )
    ).toBeUndefined();
  });

  it('returns undefined if region does not match target country', () => {
    expect(
      buildOfferShippingDetails(
        'US',
        'USD',
        makeShippingProfile({ regions: ['NG'] })
      )
    ).toBeUndefined();
  });

  it('rejects city-only regions that do not resolve to country level', () => {
    expect(
      buildOfferShippingDetails(
        'NG',
        'NGN',
        makeShippingProfile({ regions: ['Lagos'] })
      )
    ).toBeUndefined();
  });

  it('matches country name to ISO-2 code across policy regions and target country', () => {
    const detailsFromName = buildOfferShippingDetails(
      'NG',
      'NGN',
      makeShippingProfile({ regions: ['Nigeria'] })
    );
    expect(detailsFromName?.shippingDestination).toEqual({
      '@type': 'DefinedRegion',
      addressCountry: 'NG',
    });

    const detailsToName = buildOfferShippingDetails(
      'Nigeria',
      'NGN',
      makeShippingProfile({ regions: ['NG'] })
    );
    expect(detailsToName?.shippingDestination).toEqual({
      '@type': 'DefinedRegion',
      addressCountry: 'NG',
    });
  });

  it('returns undefined if handling or transit day ranges are invalid', () => {
    expect(
      buildOfferShippingDetails(
        'NG',
        'NGN',
        makeShippingProfile({ handlingDaysMin: 2, handlingDaysMax: 1 })
      )
    ).toBeUndefined();

    expect(
      buildOfferShippingDetails(
        'NG',
        'NGN',
        makeShippingProfile({ transitDaysMin: 5, transitDaysMax: 3 })
      )
    ).toBeUndefined();

    expect(
      buildOfferShippingDetails(
        'NG',
        'NGN',
        makeShippingProfile({ handlingDaysMin: -1, handlingDaysMax: 2 })
      )
    ).toBeUndefined();

    expect(
      buildOfferShippingDetails(
        'NG',
        'NGN',
        makeShippingProfile({ transitDaysMin: 1.5, transitDaysMax: 3 })
      )
    ).toBeUndefined();

    expect(
      buildOfferShippingDetails(
        'NG',
        'NGN',
        makeShippingProfile({ handlingDaysMax: undefined })
      )
    ).toBeUndefined();

    expect(
      buildOfferShippingDetails(
        'NG',
        'NGN',
        makeShippingProfile({ transitDaysMax: undefined })
      )
    ).toBeUndefined();
  });

  it('builds full OfferShippingDetails when shipping is free with matching region and valid timing', () => {
    const details = buildOfferShippingDetails(
      'NG',
      'NGN',
      makeShippingProfile({ regions: ['Nigeria', 'NG'], transitDaysMax: 4 })
    );

    expect(details).toEqual({
      '@type': 'OfferShippingDetails',
      shippingRate: {
        '@type': 'MonetaryAmount',
        value: 0,
        currency: 'NGN',
      },
      shippingDestination: {
        '@type': 'DefinedRegion',
        addressCountry: 'NG',
      },
      deliveryTime: {
        '@type': 'ShippingDeliveryTime',
        handlingTime: {
          '@type': 'QuantitativeValue',
          minValue: 0,
          maxValue: 1,
          unitCode: 'DAY',
        },
        transitTime: {
          '@type': 'QuantitativeValue',
          minValue: 1,
          maxValue: 4,
          unitCode: 'DAY',
        },
      },
    });
  });
});
