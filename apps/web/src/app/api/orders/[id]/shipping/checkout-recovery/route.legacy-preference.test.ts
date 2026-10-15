import { beforeEach, describe, expect, it, vi } from 'vitest';
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
describe('legacy paid checkout shipping recovery preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeRecoveryMocks(mocks);
  });
  it('accepts a current GoStandard quote for a legacy standard label without changing the paid fee', async () => {
    mocks.quotes.mockResolvedValue([
      {
        ...quote,
        serviceTier: 'GoStandard',
        providerRateId: 'GIGL_30_0_1_0_0_4',
      },
    ]);
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      canConfirm: true,
      paidShippingFee: 110,
      quote: { price: 110 },
    });
  });
  it('uses verified rate identity despite obsolete tier and carrier labels', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        ...context,
        quote_preference: {
          ...context.quote_preference,
          service_tier: 'Legacy delivery',
          carrier_name: 'Old carrier label',
          provider_rate_id: 'GIGL_30_0_1',
        },
      },
      error: null,
    });
    mocks.quotes.mockResolvedValue([
      {
        ...quote,
        serviceTier: 'GoFaster',
        providerRateId: 'GIGL_30_0_1_0_1_4',
      },
      {
        ...quote,
        serviceTier: 'GoStandard',
        providerRateId: 'GIGL_30_0_1_0_0_4',
      },
    ]);
    const response = await request();
    expect(response.status).toBe(200);
    const staged = mocks.rpc.mock.calls.find(
      ([name]) => name === 'prepare_customer_checkout_shipping_recovery'
    );
    expect(staged?.[1].p_quote).toMatchObject({
      service_tier: 'GoStandard',
      price: 110,
    });
  });
  it('keeps the same-price gate for a matching renamed service', async () => {
    mocks.quotes.mockResolvedValue([
      { ...quote, serviceTier: 'GoStandard', price: 120 },
    ]);
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      canConfirm: false,
      previewId: null,
      paidShippingFee: 110,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('rejects a different service even when its fee matches', async () => {
    mocks.quotes.mockResolvedValue([
      {
        ...quote,
        serviceTier: 'GoFaster',
        providerRateId: 'GIGL_30_0_1_0_1_4',
      },
    ]);
    expect((await request()).status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('uses the paid-fee fallback for carrier-only historical preferences', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        ...context,
        quote_preference: {
          service_tier: null,
          carrier_name: 'GIG Logistics',
          provider_rate_id: null,
          is_station_pickup: false,
        },
      },
      error: null,
    });
    mocks.quotes.mockResolvedValue([
      { ...quote, serviceTier: 'GoStandard', price: 100 },
      { ...quote, serviceTier: 'GoFaster', price: 110 },
    ]);
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      canConfirm: true,
      paidShippingFee: 110,
    });
    const staged = mocks.rpc.mock.calls.find(
      ([name]) => name === 'prepare_customer_checkout_shipping_recovery'
    );
    expect(staged?.[1].p_quote).toMatchObject({
      service_tier: 'GoFaster',
      price: 110,
    });
  });
});
