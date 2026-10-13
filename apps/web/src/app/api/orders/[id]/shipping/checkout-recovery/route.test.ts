import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertQuoteReceiverMatchesOrder } from '@/lib/shipping/international-quote-order-guard';
import { POST } from './route';

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
const orderId = '40000000-0000-4000-8000-000000000001';
const merchantId = '10000000-0000-4000-8000-000000000001';
const quoteId = '70000000-0000-4000-8000-000000000001';
const receiver = {
  address: '12 Test Street',
  city: 'Ikeja',
  state: 'Lagos',
  phone: '08000000000',
  latitude: 6.6018,
  longitude: 3.3515,
};
const context = {
  fingerprint: 'a'.repeat(64),
  quote_preference: {
    service_tier: 'standard',
    carrier_name: 'GIG Logistics',
    provider_rate_id: 'gigl:1',
    is_station_pickup: false,
  },
  order: {
    id: orderId,
    merchant_id: merchantId,
    customer_name: 'Test Customer',
    customer_email: null,
    customer_phone: '08000000000',
    shipping_address: {
      address: '12 Test Street',
      city: 'Ikeja',
      state: 'Lagos',
    },
    shipping_fee: 110,
    order_items: [
      {
        name: 'Phone',
        quantity: 1,
        price: 1000,
        product_id: '50000000-0000-4000-8000-000000000001',
        product: {
          weight_value: 1,
          weight_unit: 'kg',
          dimensions: null,
          commodity_code: null,
        },
      },
    ],
  },
};
const quote = {
  id: quoteId,
  provider: 'GIGL',
  serviceTier: 'standard',
  carrierName: 'GIG Logistics',
  displayName: 'GIG standard',
  price: 110,
  currency: 'NGN',
  estimatedDays: 2,
  pickupIncluded: true,
  insuranceIncluded: true,
  expiresAt: new Date(Date.now() + 3600000),
  providerRateId: 'gigl:1',
  providerCost: 100,
  platformMargin: 10,
  marginBasisPoints: 1000,
  pricingVersion: 'gigl_platform_margin_v1',
  rawResponse: { credential: 'private-provider-body' },
};
function request(body: unknown = { action: 'preview', receiver }) {
  return POST(
    new NextRequest(
      `https://usebaci.com/api/orders/${orderId}/shipping/checkout-recovery`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
    { params: Promise.resolve({ id: orderId }) }
  );
}
describe('paid checkout shipping recovery route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: { id: 'owner' },
      supabase: { rpc: mocks.rpc },
    });
    mocks.csrf.mockResolvedValue({ valid: true });
    mocks.access.mockResolvedValue({ isOwner: true, merchantId });
    mocks.permission.mockReturnValue(true);
    mocks.sender.mockResolvedValue({
      ok: true,
      sender: {
        ...receiver,
        name: 'Merchant',
        country: 'Nigeria',
        countryCode: 'NG',
      },
    });
    mocks.quotes.mockResolvedValue([quote]);
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'get_customer_checkout_shipping_recovery_context'
        ? { data: context, error: null }
        : { data: quoteId, error: null }
    );
  });
  it('requires authentication before quoting', async () => {
    mocks.auth.mockResolvedValue({ user: null });
    expect((await request()).status).toBe(401);
    expect(mocks.quotes).not.toHaveBeenCalled();
  });
  it('requires CSRF protection', async () => {
    mocks.csrf.mockResolvedValue({ valid: false });
    expect((await request()).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires owner and fulfillment/edit authorization', async () => {
    mocks.access.mockResolvedValue({ isOwner: false, merchantId });
    expect((await request()).status).toBe(403);
    mocks.access.mockResolvedValue({ isOwner: true, merchantId });
    mocks.permission.mockImplementation(
      (_a: unknown, _r: string, permission: string) => permission !== 'edit'
    );
    expect((await request()).status).toBe(403);
    expect(mocks.quotes).not.toHaveBeenCalled();
  });
  it.each([
    { ...receiver, latitude: undefined },
    { ...receiver, longitude: 181 },
    { ...receiver, latitude: '6.6' },
  ])('requires a validated complete explicit pin %j', async (invalid) => {
    expect(
      (await request({ action: 'preview', receiver: invalid })).status
    ).toBe(400);
    expect(mocks.quotes).not.toHaveBeenCalled();
  });
  it('stages a server-proof-bound preview and returns only public quote data', async () => {
    const response = await request();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      previewId: quoteId,
      paidShippingFee: 110,
      canConfirm: true,
      quote: { price: 110 },
    });
    expect(JSON.stringify(body)).not.toMatch(
      /providerCost|platformMargin|credential|payload_text|signature/
    );
    const staged = mocks.rpc.mock.calls.find(
      ([name]) => name === 'prepare_customer_checkout_shipping_recovery'
    );
    expect(staged?.[1]).toMatchObject({
      p_order_id: orderId,
      p_fingerprint: context.fingerprint,
      p_quote: { quote_request: { receiver } },
      p_route_proof: { action: 'prepare_customer_checkout_shipping_recovery' },
    });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain(
      'confirm_customer_checkout_shipping_recovery'
    );
  });
  it('shows a changed price without staging or introducing a funding step', async () => {
    mocks.quotes.mockResolvedValue([{ ...quote, price: 120 }]);
    const body = await (await request()).json();
    expect(body).toMatchObject({
      previewId: null,
      paidShippingFee: 110,
      canConfirm: false,
      quote: { price: 120 },
    });
    expect(body.error).toContain('already paid');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('does not quote for a context belonging to another merchant', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ...context,
        order: {
          ...context.order,
          merchant_id: '10000000-0000-4000-8000-000000000002',
        },
      },
      error: null,
    });
    expect((await request()).status).toBe(500);
    expect(mocks.quotes).not.toHaveBeenCalled();
  });
  it('requires separate explicit confirmation, with no carrier call', async () => {
    mocks.rpc.mockResolvedValue({
      data: { quoteId, confirmed: true },
      error: null,
    });
    const response = await request({
      action: 'confirm',
      previewId: quoteId,
      confirmDestination: true,
    });
    expect(await response.json()).toEqual({ quoteId, confirmed: true });
    expect(mocks.quotes).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      'confirm_customer_checkout_shipping_recovery',
      {
        p_order_id: orderId,
        p_preview_id: quoteId,
        p_confirm_destination: true,
      }
    );
  });
  it('refuses missing confirmation', async () => {
    expect(
      (
        await request({
          action: 'confirm',
          previewId: quoteId,
          confirmDestination: false,
        })
      ).status
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('maps concurrent changes to a retryable conflict', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '40001', message: 'shipping_recovery_stale' },
    });
    const response = await request({
      action: 'confirm',
      previewId: quoteId,
      confirmDestination: true,
    });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('SHIPPING_RECOVERY_STALE');
  });
  it('fails closed on provider failure', async () => {
    mocks.quotes.mockRejectedValue(new Error('provider unavailable'));
    expect((await request()).status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('does not silently switch the purchased service tier', async () => {
    mocks.quotes.mockResolvedValue([{ ...quote, serviceTier: 'express' }]);
    expect((await request()).status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('keeps a composed address compatible with the unchanged booking guard', async () => {
    await request({
      action: 'preview',
      receiver: { ...receiver, address: '12 Test Street, Ikeja, Lagos' },
    });
    const staged = mocks.rpc.mock.calls.find(
      ([name]) => name === 'prepare_customer_checkout_shipping_recovery'
    );
    const quoteRequest = staged?.[1].p_quote.quote_request;
    expect(() =>
      assertQuoteReceiverMatchesOrder(quoteRequest, {
        shipping_address: quoteRequest.receiver,
      })
    ).not.toThrow();
  });
});
