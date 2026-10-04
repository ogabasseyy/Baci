import { describe, expect, it } from 'vitest';
import { prefundedCardProviderSchemas } from './prefunded-card-provider';

const settings = {
  paystackSecret: 'sk_test_example',
  piggyvest: {
    apiSecret: 'pv_staging_example',
    expectedBusinessId: 'business_1',
    expectedCurrency: 'NGN',
  },
  scope: {
    integrationId: '10000000-0000-4000-8000-000000000001',
    merchantId: '10000000-0000-4000-8000-000000000002',
    treasuryBindingId: '10000000-0000-4000-8000-000000000003',
    sourceWalletId: 'wallet_source',
  },
};

describe('prefunded card provider settings', () => {
  it('accepts only the configured staging PiggyVest integration', () => {
    expect(
      prefundedCardProviderSchemas.settings.parse(settings).piggyvest.apiBaseUrl
    ).toBe('https://staging.piggyvest.business');
  });

  it('rejects an NGN provider adapter configured for another currency', () => {
    expect(
      prefundedCardProviderSchemas.settings.safeParse({
        ...settings,
        piggyvest: { ...settings.piggyvest, expectedCurrency: 'USD' },
      }).success
    ).toBe(false);
  });

  it('rejects a live Paystack secret before any provider request can be built', () => {
    expect(
      prefundedCardProviderSchemas.settings.safeParse({
        ...settings,
        paystackSecret: 'sk_live_example',
      }).success
    ).toBe(false);
  });

  it('rejects a malformed Paystack test secret', () => {
    expect(
      prefundedCardProviderSchemas.settings.safeParse({
        ...settings,
        paystackSecret: 'sk_test_has_underscores',
      }).success
    ).toBe(false);
  });
});
