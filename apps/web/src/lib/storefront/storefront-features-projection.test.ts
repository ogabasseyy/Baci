import { describe, expect, it } from 'vitest';
import { buildPublicStorefrontFeatures } from './storefront-features-projection';

describe('buildPublicStorefrontFeatures', () => {
  const baseMerchant = {
    id: 'merchant-1',
    country: 'NG',
    business_type: 'electronics',
  };

  it('returns safe public defaults when settings are empty', () => {
    const features = buildPublicStorefrontFeatures({
      merchant: baseMerchant,
      settings: {},
      paystackSubaccountConfigured: true,
    });

    expect(features.paystackEnabled).toBe(true);
    expect(features.korapayEnabled).toBe(false);
    expect(features.reviewsEnabled).toBe(true);
    expect(features.wishlistEnabled).toBe(true);
    expect(features.preferredLocalGateway).toBe('paystack');
    expect(features.preferredInternationalGateway).toBe('korapay');
    expect(features.vtuCheckoutAddonAmounts).toEqual([100, 200, 500, 1000]);
    expect(features.freeShippingThreshold).toBeNull();
    expect(features.pages).toEqual({
      about: true,
      contact: true,
      faq: true,
      privacy: true,
      terms: true,
      rewards: false,
    });
    expect(features.credpalEnabled).toBe(false);
  });

  it('falls back to defaults on malformed setting types', () => {
    const features = buildPublicStorefrontFeatures({
      merchant: baseMerchant,
      settings: {
        loyalty_enabled: 'yes',
        credit_direct_min_amount: Number.NaN,
        free_shipping_threshold: Number.POSITIVE_INFINITY,
        vtu_checkout_addon_amounts: [100, 'bad'],
        preferred_local_gateway: 'stripe',
        preferred_international_gateway: 123,
      },
      paystackSubaccountConfigured: true,
    });

    expect(features.loyaltyEnabled).toBe(false);
    expect(features.creditDirectMinAmount).toBe(10000);
    expect(features.freeShippingThreshold).toBeNull();
    expect(features.vtuCheckoutAddonAmounts).toEqual([100, 200, 500, 1000]);
    expect(features.preferredLocalGateway).toBe('paystack');
    expect(features.preferredInternationalGateway).toBe('korapay');
  });

  it('normalizes preferred paystack gateways to korapay when paystack is unavailable', () => {
    const features = buildPublicStorefrontFeatures({
      merchant: baseMerchant,
      settings: {
        preferred_local_gateway: 'paystack',
        preferred_international_gateway: 'paystack',
      },
      paystackSubaccountConfigured: false,
    });

    expect(features.paystackEnabled).toBe(false);
    expect(features.preferredLocalGateway).toBe('korapay');
    expect(features.preferredInternationalGateway).toBe('korapay');
  });
});
