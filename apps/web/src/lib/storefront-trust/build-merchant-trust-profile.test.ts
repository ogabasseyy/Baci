import { describe, expect, it } from 'vitest';
import { buildMerchantTrustProfile } from './build-merchant-trust-profile';
import type { MerchantTrustProfileSource } from './merchant-trust-profile-types';

const merchantFixture: MerchantTrustProfileSource = {
  support_email: 'support@ogabassey.com',
  support_phone: '+2348000000000',
  social_media: { instagram: '@ogabassey', twitter: '@ogabasseyhq' },
  business_address: '12 Allen Avenue, Ikeja, Lagos',
  legal_entity_name: 'Ogabassey Gadgets Ltd',
  registered_address: {
    street: '12 Allen Avenue',
    city: 'Ikeja',
    state: 'Lagos',
    country: 'Nigeria',
  },
  tax_identification_number: 'TIN-123',
  pages: {
    privacy: 'Privacy copy',
    contact: 'Contact copy',
    terms: 'Terms copy',
  },
  trust_profile: {
    founded_year: 2018,
    customer_service: {
      whatsapp_number: '+2348111111111',
      hours_summary: 'Mon-Sat, 8am-6pm',
      timezone: 'Africa/Lagos',
      response_time_summary: 'Within 2 business hours',
    },
    return_policy: {
      summary: 'Returns accepted for defective items.',
      window_days: 7,
      return_method: 'mail',
      return_fees: 'free',
    },
    shipping_policy: {
      summary: 'Nationwide delivery available.',
      regions: ['NG'],
      handling_days_min: 0,
      handling_days_max: 1,
      transit_days_min: 1,
      transit_days_max: 5,
      shipping_fee_type: 'calculated',
    },
    warranty_policy: { summary: 'Manufacturer warranty applies.' },
  },
};

describe('buildMerchantTrustProfile', () => {
  it('assembles trust data from merchant columns and trust_profile fields', () => {
    const result = buildMerchantTrustProfile(
      merchantFixture,
      'https://ogabassey.com'
    );

    expect(result).toMatchObject({
      supportEmail: 'support@ogabassey.com',
      supportPhone: '+2348000000000',
      socialLinks: {
        instagram: 'https://instagram.com/ogabassey',
        twitter: 'https://x.com/ogabasseyhq',
      },
      businessAddress: '12 Allen Avenue, Ikeja, Lagos',
      registeredAddress: {
        street: '12 Allen Avenue',
        city: 'Ikeja',
        state: 'Lagos',
        country: 'Nigeria',
      },
      legalEntityName: 'Ogabassey Gadgets Ltd',
      taxIdentificationNumber: 'TIN-123',
      foundedYear: 2018,
      customerServiceHours: {
        summary: 'Mon-Sat, 8am-6pm',
        timezone: 'Africa/Lagos',
        responseTimeSummary: 'Within 2 business hours',
      },
      returnPolicy: {
        summary: 'Returns accepted for defective items.',
        windowDays: 7,
        returnMethod: 'mail',
        returnFees: 'free',
        localRoute: '/returns',
      },
      shippingPolicy: {
        summary: 'Nationwide delivery available.',
        regions: ['NG'],
        handlingDaysMin: 0,
        handlingDaysMax: 1,
        transitDaysMin: 1,
        transitDaysMax: 5,
        shippingFeeType: 'calculated',
        localRoute: '/shipping',
      },
      warrantyPolicy: {
        summary: 'Manufacturer warranty applies.',
        localRoute: '/warranty',
      },
      derivedLinks: {
        contact: 'https://ogabassey.com/contact',
        privacy: 'https://ogabassey.com/privacy',
        terms: 'https://ogabassey.com/terms',
        returns: 'https://ogabassey.com/returns',
        shipping: 'https://ogabassey.com/shipping',
        warranty: 'https://ogabassey.com/warranty',
      },
    });
  });

  it('returns a sparse profile for an empty trust payload', () => {
    const result = buildMerchantTrustProfile(
      {
        trust_profile: {},
      },
      'https://ogabassey.com'
    );

    expect(result).toEqual({
      socialLinks: {},
      derivedLinks: {},
    });
  });

  it('normalizes explicit X URLs to x.com', () => {
    const result = buildMerchantTrustProfile({
      social_media: {
        twitter: 'http://x.com/ogabasseyhq',
      },
    });

    expect(result.socialLinks.twitter).toBe('https://x.com/ogabasseyhq');

    const rootResult = buildMerchantTrustProfile({
      social_media: {
        twitter: 'https://www.x.com',
      },
    });

    expect(rootResult.socialLinks.twitter).toBe('https://x.com');
  });

  it('uses the shared social URL normalizer for supported platform handles', () => {
    const result = buildMerchantTrustProfile({
      social_media: {
        pinterest: '@ogabassey',
        snapchat: 'ogabassey',
      },
    });

    expect(result.socialLinks).toMatchObject({
      pinterest: 'https://pinterest.com/ogabassey',
      snapchat: 'https://www.snapchat.com/@ogabassey',
    });
  });

  it('preserves absolute URLs for custom social platforms', () => {
    const result = buildMerchantTrustProfile({
      social_media: {
        threads: 'https://threads.net/@ogabassey',
      },
    });

    expect(result.socialLinks.threads).toBe('https://threads.net/@ogabassey');
  });

  it('publishes derived returns links when only method and fee details exist', () => {
    const result = buildMerchantTrustProfile(
      {
        trust_profile: {
          return_policy: {
            return_method: 'mail',
            return_fees: 'free',
          },
        },
      },
      'https://ogabassey.com'
    );

    expect(result.returnPolicy).toMatchObject({
      returnMethod: 'mail',
      returnFees: 'free',
    });
    expect(result.derivedLinks.returns).toBe('https://ogabassey.com/returns');
  });

  it('publishes derived shipping links when only timing and fee details exist', () => {
    const result = buildMerchantTrustProfile(
      {
        trust_profile: {
          shipping_policy: {
            handling_days_min: 0,
            transit_days_min: 1,
            shipping_fee_type: 'calculated',
          },
        },
      },
      'https://ogabassey.com'
    );

    expect(result.shippingPolicy).toMatchObject({
      handlingDaysMin: 0,
      transitDaysMin: 1,
      shippingFeeType: 'calculated',
    });
    expect(result.derivedLinks.shipping).toBe('https://ogabassey.com/shipping');
  });

  it('publishes privacy and terms links for template-backed storefront pages', () => {
    const result = buildMerchantTrustProfile(
      {
        template_id: 'modern-electronics',
        pages: {
          privacy: null,
          terms: null,
        },
        trust_profile: {},
      },
      'https://ogabassey.com'
    );

    expect(result.derivedLinks).toMatchObject({
      privacy: 'https://ogabassey.com/privacy',
      terms: 'https://ogabassey.com/terms',
    });
  });

  it('normalizes enabled Google review settings into merchant review authority', () => {
    const result = buildMerchantTrustProfile(
      {
        feature_settings: {
          google_reviews_enabled: true,
          google_place_id: ' places/ChIJ1234 ',
        },
      },
      'https://ogabassey.com'
    );

    expect(result.merchantReviewAuthority).toEqual({
      attributionLabel: 'Google Maps',
      placeId: 'ChIJ1234',
      reviewsSortedBy: 'relevance',
      source: 'google_maps',
    });
  });

  it('omits merchant review authority when Google reviews are disabled', () => {
    const result = buildMerchantTrustProfile({
      feature_settings: {
        google_reviews_enabled: false,
        google_place_id: 'ChIJ1234',
      },
    });

    expect(result.merchantReviewAuthority).toBeUndefined();
  });

  it('omits merchant review authority when the Google Place ID is invalid', () => {
    const result = buildMerchantTrustProfile({
      feature_settings: {
        google_reviews_enabled: true,
        google_place_id: '   ',
      },
    });

    expect(result.merchantReviewAuthority).toBeUndefined();
  });
});
