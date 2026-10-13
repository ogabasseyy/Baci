import { describe, expect, it } from 'vitest';
import { merchantFeatureSettingsDefaults } from '@/lib/merchant-feature-settings-defaults';

describe('merchant feature settings defaults', () => {
  it('uses the same payment defaults for protected and public reads', () => {
    const protectedDefaults =
      merchantFeatureSettingsDefaults.buildDefault('merchant-1');
    const publicDefaults =
      merchantFeatureSettingsDefaults.buildPublicDefault('merchant-1');

    // Korapay defaults OFF (opt-in for all currencies) — aligned with the DB
    // column default and the strict checkout gate; Paystack stays default ON.
    expect(protectedDefaults).toMatchObject({
      merchant_id: 'merchant-1',
      paystack_enabled: true,
      korapay_enabled: false,
      klump_max_amount: 1_000_000,
      preferred_local_gateway: 'paystack',
      preferred_international_gateway: 'korapay',
    });
    expect(publicDefaults).toMatchObject({
      merchant_id: 'merchant-1',
      paystack_enabled: true,
      korapay_enabled: false,
      klump_max_amount: 1_000_000,
      preferred_local_gateway: 'paystack',
      preferred_international_gateway: 'korapay',
    });
  });

  it('does not expose private token default keys through public defaults', () => {
    const publicDefaults =
      merchantFeatureSettingsDefaults.buildPublicDefault('merchant-1');

    expect(publicDefaults).not.toHaveProperty('facebook_capi_token');
    expect(publicDefaults).not.toHaveProperty('ga4_api_secret');
    expect(publicDefaults).not.toHaveProperty('tiktok_access_token');
  });

  it('returns fresh mutable arrays and objects for each call', () => {
    const first = merchantFeatureSettingsDefaults.buildDefault('merchant-1');
    const second = merchantFeatureSettingsDefaults.buildDefault('merchant-1');

    expect(first.shipping_providers).toEqual([]);
    expect(first.shipping_providers).not.toBe(second.shipping_providers);
    expect(first.custom_settings).toEqual({});
    expect(first.custom_settings).not.toBe(second.custom_settings);

    const firstPublic =
      merchantFeatureSettingsDefaults.buildPublicDefault('merchant-1');
    const secondPublic =
      merchantFeatureSettingsDefaults.buildPublicDefault('merchant-1');

    expect(firstPublic.shipping_providers).toEqual([]);
    expect(firstPublic.shipping_providers).not.toBe(
      secondPublic.shipping_providers
    );
    expect(firstPublic.custom_settings).toEqual({});
    expect(firstPublic.custom_settings).not.toBe(secondPublic.custom_settings);
  });

  it('keeps every public default key backed by the shared default object', () => {
    const publicDefaults =
      merchantFeatureSettingsDefaults.buildPublicDefault('merchant-1');

    for (const key of merchantFeatureSettingsDefaults.publicKeys) {
      expect(merchantFeatureSettingsDefaults.defaults).toHaveProperty(key);
      expect(publicDefaults[key]).not.toBeUndefined();
    }
  });
});
