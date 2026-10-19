import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRedvaultLivePilotPolicy,
  validateRedvaultLivePilotOrder,
} from './redvault-live-pilot';
import { rejectDisallowedRedvaultLivePilotOrder } from './redvault-live-pilot-order-gate';
import { getRedvaultPaymentAvailability } from './redvault-payment-availability';

const line = {
  brand: 'Apple',
  name: 'Pilot product',
  condition: null,
  lineId: 0,
  variantAttributes: null,
  unitDiscountsKobo: [500],
  productId: '11111111-1111-4111-8111-111111111111',
  quantity: 1,
  variantId: null,
  unitPriceKobo: 10_000,
  discountKobo: 500,
  vatRateBp: 750,
  vatCategoryCode: 'S',
};
const basket = {
  userId: null,
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  currency: 'NGN',
  items: [line],
  subtotalKobo: 10_000,
  discountKobo: 500,
  taxAmountKobo: 750,
  shippingFee: 0,
  assuranceAmount: 0,
  wrappingFee: 0,
  walletAmount: 0,
  savingsAmount: 0,
};

describe('REDVAULT explicit public product test', () => {
  beforeEach(() => {
    vi.stubEnv('BACI_RUNTIME_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('REDVAULT_LIVE_PILOT_ENABLED', 'true');
    vi.stubEnv('REDVAULT_LIVE_PILOT_AUDIENCE', 'public_product_test');
    vi.stubEnv(
      'REDVAULT_LIVE_PILOT_SUPABASE_URL',
      'https://fixture.supabase.co'
    );
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.supabase.co');
    vi.stubEnv('REDVAULT_LIVE_PILOT_MERCHANT_ID', basket.merchantId);
    vi.stubEnv('REDVAULT_LIVE_PILOT_PRODUCT_ID', line.productId);
    vi.stubEnv('REDVAULT_LIVE_PILOT_EXPIRES_AT', '');
    vi.stubEnv('REDVAULT_LIVE_PILOT_MAX_ATTEMPTS', '');
    vi.stubEnv('REDVAULT_LIVE_PROVIDER_EVIDENCE', 'confirmed');
    vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_live_fixture');
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    null,
    'unrestricted-customer',
  ])('admits %j without an expiry or global attempt cap', (userId) => {
    expect(validateRedvaultLivePilotOrder({ ...basket, userId })).toBe(true);
    expect(getRedvaultLivePilotPolicy()).toMatchObject({
      audience: 'public_product_test',
      expiresAt: null,
      maxAttempts: null,
    });
    expect(getRedvaultPaymentAvailability()).toEqual({
      available: true,
      reason: 'public_product_test',
    });
  });

  it('does not apply legacy expiry or attempt limits to the explicit public audience', () => {
    vi.stubEnv('REDVAULT_LIVE_PILOT_EXPIRES_AT', '2000-01-01T00:00:00Z');
    vi.stubEnv('REDVAULT_LIVE_PILOT_MAX_ATTEMPTS', '1');
    expect(validateRedvaultLivePilotOrder(basket)).toBe(true);
    expect(
      validateRedvaultLivePilotOrder({ ...basket, userId: 'next-customer' })
    ).toBe(true);
    expect(getRedvaultLivePilotPolicy(Date.parse('2040-01-01'))).toMatchObject({
      expiresAt: null,
      maxAttempts: null,
    });
  });

  it.each([
    '',
    'unknown',
    'PUBLIC_PRODUCT_TEST',
  ])('never infers public access from missing expiry with audience %j', (audience) => {
    vi.stubEnv('REDVAULT_LIVE_PILOT_AUDIENCE', audience);
    expect(getRedvaultLivePilotPolicy()).toBeNull();
    expect(validateRedvaultLivePilotOrder(basket)).toBe(false);
  });

  it.each([
    ['REDVAULT_LIVE_PILOT_ENABLED', ''],
    ['BACI_RUNTIME_ENV', 'staging'],
    ['VERCEL_ENV', 'preview'],
    ['REDVAULT_LIVE_PILOT_MERCHANT_ID', 'other-merchant'],
    ['REDVAULT_LIVE_PILOT_PRODUCT_ID', 'invalid'],
    ['REDVAULT_LIVE_PROVIDER_EVIDENCE', ''],
    ['PAYSTACK_SECRET_KEY', 'sk_test_fixture'],
    ['NEXT_PUBLIC_SUPABASE_URL', 'https://other.supabase.co'],
  ])('retains the activation guard for %s', (name, value) => {
    vi.stubEnv(name, value);
    expect(validateRedvaultLivePilotOrder(basket)).toBe(false);
  });

  it.each([
    { merchantId: 'other-merchant' },
    { currency: 'USD' },
    { items: [] },
    { items: [line, line] },
    { items: [{ ...line, productId: '22222222-2222-4222-8222-222222222222' }] },
    { items: [{ ...line, quantity: 2 }] },
    { items: [{ ...line, variantId: 'variant' }] },
    { items: [{ ...line, unitPriceKobo: 9999 }] },
    { items: [{ ...line, discountKobo: 499 }] },
    { subtotalKobo: 9999 },
    { discountKobo: 499 },
    { taxAmountKobo: 0 },
    { shippingFee: 1 },
    { assuranceAmount: 1 },
    { wrappingFee: 1 },
    { walletAmount: 1 },
    { savingsAmount: 1 },
  ])('rejects basket drift %j for a guest', (override) => {
    expect(validateRedvaultLivePilotOrder({ ...basket, ...override })).toBe(
      false
    );
  });

  it('enforces the public basket gate during order creation', () => {
    const input = {
      redvaultRequested: true,
      redvaultQuote: {
        lines: [line],
        groups: [],
        productSubtotalKobo: 10_000,
        eligibleSubtotalKobo: 10_000,
        discountKobo: 500,
      },
      userId: null,
      merchantId: basket.merchantId,
      currency: 'NGN',
      shippingFee: 0,
      wrappingFee: 0,
      orderItems: [{ assurance_fee: 0 }],
      useWalletCredit: false,
      walletAmount: 0,
      useSavingsCredit: false,
      savingsAmount: 0,
      taxAmount: 7.5,
    };
    expect(rejectDisallowedRedvaultLivePilotOrder(input)).toBeNull();
    expect(
      rejectDisallowedRedvaultLivePilotOrder({ ...input, shippingFee: 1 })
        ?.status
    ).toBe(409);
  });
});
