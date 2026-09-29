import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getRedvaultLivePilotPolicy,
  REDVAULT_PILOT_USER_ID,
  validateRedvaultLivePilotOrder,
} from './redvault-live-pilot';

const base = {
  userId: REDVAULT_PILOT_USER_ID,
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  currency: 'NGN',
  items: [
    {
      productId: '11111111-1111-4111-8111-111111111111',
      quantity: 1,
      variantId: null,
      unitPriceKobo: 10_000,
      discountKobo: 500,
    },
  ],
  subtotalKobo: 10_000,
  discountKobo: 500,
  shippingFee: 0,
  assuranceAmount: 0,
  wrappingFee: 0,
  walletAmount: 0,
  savingsAmount: 0,
};

describe('REDVAULT private live pilot policy', () => {
  afterEach(() => vi.unstubAllEnvs());
  function configure() {
    vi.stubEnv('BACI_RUNTIME_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv(
      'REDVAULT_LIVE_PILOT_SUPABASE_URL',
      'https://pilot-fixture.supabase.co'
    );
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://pilot-fixture.supabase.co');
    vi.stubEnv('REDVAULT_LIVE_PILOT_ENABLED', 'true');
    vi.stubEnv('REDVAULT_LIVE_PILOT_MERCHANT_ID', base.merchantId);
    vi.stubEnv('REDVAULT_LIVE_PILOT_PRODUCT_ID', base.items[0].productId);
    vi.stubEnv('REDVAULT_LIVE_PILOT_EXPIRES_AT', '2030-01-01T00:00:00Z');
    vi.stubEnv('REDVAULT_LIVE_PILOT_MAX_ATTEMPTS', '1');
    vi.stubEnv('REDVAULT_LIVE_PROVIDER_EVIDENCE', 'confirmed');
    vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_live_fixture');
  }
  it('stays disabled by default and until provider and live credentials are configured', () => {
    expect(getRedvaultLivePilotPolicy()).toBeNull();
    configure();
    vi.stubEnv('REDVAULT_LIVE_PROVIDER_EVIDENCE', '');
    expect(getRedvaultLivePilotPolicy()).toBeNull();
  });
  it.each([
    ['BACI_RUNTIME_ENV', 'staging'],
    ['VERCEL_ENV', 'preview'],
    ['REDVAULT_LIVE_PILOT_SUPABASE_URL', ''],
    ['NEXT_PUBLIC_SUPABASE_URL', 'https://different.supabase.co'],
  ])('rejects an unbound deployment when %s changes', (name, value) => {
    configure();
    vi.stubEnv(name, value);
    expect(getRedvaultLivePilotPolicy()).toBeNull();
  });
  it('requires exact authenticated identity and one 100 NGN product with a 5 NGN discount', () => {
    configure();
    expect(validateRedvaultLivePilotOrder(base)).toBe(true);
    for (const override of [
      { userId: null },
      { userId: 'other-user' },
      { merchantId: 'other' },
      { currency: 'USD' },
      { items: [...base.items, ...base.items] },
      { items: [{ ...base.items[0], quantity: 2 }] },
      {
        items: [
          {
            ...base.items[0],
            productId: '22222222-2222-4222-8222-222222222222',
          },
        ],
      },
      {
        items: [
          {
            ...base.items[0],
            variantId: '33333333-3333-4333-8333-333333333333',
          },
        ],
      },
      { items: [{ ...base.items[0], unitPriceKobo: 9_900 }] },
      { discountKobo: 600 },
      { shippingFee: 1 },
      { assuranceAmount: 1 },
      { wrappingFee: 1 },
      { walletAmount: 1 },
      { savingsAmount: 1 },
    ])
      expect(validateRedvaultLivePilotOrder({ ...base, ...override })).toBe(
        false
      );
  });
  it.each([
    'http://pilot-fixture.supabase.co',
    'https://pilot-fixture.supabase.co.evil.example',
    'https://user:password@pilot-fixture.supabase.co',
    'https://pilot-fixture.supabase.co/rest/v1',
    'https://pilot-fixture.supabase.co?project=other',
    'https://pilot-fixture.supabase.co#other',
    'not-a-url',
  ])('rejects an unsafe database binding %s', (url) => {
    configure();
    vi.stubEnv('REDVAULT_LIVE_PILOT_SUPABASE_URL', url);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', url);
    expect(getRedvaultLivePilotPolicy()).toBeNull();
  });
  it('rejects expired policies, invalid attempt bounds, and a different merchant binding', () => {
    configure();
    expect(getRedvaultLivePilotPolicy(Date.parse('2031-01-01'))).toBeNull();
    vi.stubEnv('REDVAULT_LIVE_PILOT_MAX_ATTEMPTS', '2');
    expect(getRedvaultLivePilotPolicy()).toBeNull();
    vi.stubEnv('REDVAULT_LIVE_PILOT_MAX_ATTEMPTS', '1');
    vi.stubEnv('REDVAULT_LIVE_PILOT_MERCHANT_ID', 'other');
    expect(getRedvaultLivePilotPolicy()).toBeNull();
  });
});
