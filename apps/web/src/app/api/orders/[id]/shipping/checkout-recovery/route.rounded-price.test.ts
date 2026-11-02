import { beforeEach, describe, expect, it, vi } from 'vitest';
import { priceGiglQuote } from '@/lib/shipping/gigl-platform-pricing';
import {
  recoveryContext as context,
  primeRecoveryMocks,
  recoveryQuote as quote,
  postRecovery as request,
} from './route.test-support';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  access: vi.fn(),
  permission: vi.fn(),
  rpc: vi.fn(),
  quotes: vi.fn(),
  sender: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.auth,
  getUserAccess: mocks.access,
  hasPermission: mocks.permission,
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/shipping/resolve-booking-merchant-sender', () => ({
  resolveBookingMerchantSender: mocks.sender,
}));
vi.mock('@/lib/shipping', () => ({
  ShippingService: class {
    getProviderQuotes = mocks.quotes;
  },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));

// Paid before NGN 100 rounding: cost 44,091.27 -> 48,500.40. The fresh quote
// for the same cost is now 48,600.
const PAID_FEE = 48_500.4;
const standard = { ...quote, ...priceGiglQuote(44_091.27) };
const express = {
  ...quote,
  id: '70000000-0000-4000-8000-000000000002',
  serviceTier: 'express',
  providerRateId: 'gigl:2',
  ...priceGiglQuote(50_000),
};

function primeContext(quotePreference: unknown) {
  mocks.rpc.mockImplementation(async (name: string) =>
    name === 'get_customer_checkout_shipping_recovery_context'
      ? {
          data: {
            ...context,
            quote_preference: quotePreference,
            order: { ...context.order, shipping_fee: PAID_FEE },
          },
          error: null,
        }
      : { data: quote.id, error: null }
  );
}

function stagedQuote() {
  return mocks.rpc.mock.calls.find(
    ([name]) => name === 'prepare_customer_checkout_shipping_recovery'
  )?.[1].p_quote;
}

describe('bugfix: recovery of an order paid at an unrounded v1 GIGL fee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeRecoveryMocks(mocks);
  });

  it('stages the fresh quote at the paid fee instead of reporting a price change', async () => {
    primeContext(context.quote_preference);
    mocks.quotes.mockResolvedValue([standard]);

    const body = await (await request()).json();

    expect(body).toMatchObject({
      canConfirm: true,
      paidShippingFee: PAID_FEE,
      quote: { price: PAID_FEE },
    });
    expect(stagedQuote()).toMatchObject({
      price: PAID_FEE,
      provider_cost: 44_091.27,
      platform_margin: 4_409.13,
      platform_margin_bps: 1000,
      pricing_version: 'gigl_platform_margin_v1',
    });
  });

  it('matches the paid service by price when no preference was saved', async () => {
    primeContext(null);
    mocks.quotes.mockResolvedValue([express, standard]);

    const body = await (await request()).json();

    expect(body).toMatchObject({
      canConfirm: true,
      quote: { price: PAID_FEE, serviceTier: 'standard' },
    });
    expect(stagedQuote()).toMatchObject({ id: standard.id, price: PAID_FEE });
  });

  it('still refuses a fresh tariff that matches neither v1 price', async () => {
    primeContext(context.quote_preference);
    mocks.quotes.mockResolvedValue([
      { ...quote, ...priceGiglQuote(45_000.01) },
    ]);

    const body = await (await request()).json();

    expect(body).toMatchObject({
      canConfirm: false,
      previewId: null,
      paidShippingFee: PAID_FEE,
      quote: { price: 49_600 },
    });
    expect(stagedQuote()).toBeUndefined();
  });
});
