import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertQuoteReceiverMatchesOrder } from '@/lib/shipping/international-quote-order-guard';
import { POST } from './route';
import {
  recoveryContext as context,
  recoveryMerchantId as merchantId,
  recoveryOrderId as orderId,
  primeRecoveryMocks,
  recoveryQuote as quote,
  recoveryQuoteId as quoteId,
  recoveryReceiver as receiver,
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
describe('paid checkout shipping recovery route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeRecoveryMocks(mocks);
  });
  it('requires authentication before quoting', async () => {
    mocks.auth.mockResolvedValue({ user: null });
    expect((await request()).status).toBe(401);
    expect(mocks.quotes).not.toHaveBeenCalled();
  });
  it('authenticates before rejecting malformed order ids', async () => {
    const malformed = () =>
      POST(
        new NextRequest(
          'https://usebaci.com/api/orders/not-a-uuid/shipping/checkout-recovery',
          {
            method: 'POST',
            body: JSON.stringify({ action: 'preview', receiver }),
          }
        ),
        { params: Promise.resolve({ id: 'not-a-uuid' }) }
      );
    mocks.auth.mockResolvedValue({ user: null });
    expect((await malformed()).status).toBe(401);
    expect((await request()).status).toBe(401);
  });
  it('rejects malformed order ids after authentication', async () => {
    const response = await POST(
      new NextRequest(
        'https://usebaci.com/api/orders/not-a-uuid/shipping/checkout-recovery',
        {
          method: 'POST',
          body: JSON.stringify({ action: 'preview', receiver }),
        }
      ),
      { params: Promise.resolve({ id: 'not-a-uuid' }) }
    );
    expect(response.status).toBe(400);
    expect(mocks.quotes).not.toHaveBeenCalled();
  });
  it('rejects non-Nigerian recovery destinations', async () => {
    const response = await request({
      action: 'preview',
      receiver: { ...receiver, countryCode: 'US' },
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'This recovery supports Nigerian destinations only.',
    });
    expect(mocks.quotes).not.toHaveBeenCalled();
  });
  it('accepts Nigerian recovery destinations with an explicit country code', async () => {
    const response = await request({
      action: 'preview',
      receiver: { ...receiver, countryCode: 'NG' },
    });
    expect(response.status).toBe(200);
  });
  it('validates the recovery body before querying merchant access', async () => {
    mocks.access.mockResolvedValue({ isOwner: false, merchantId: null });
    const response = await POST(
      new NextRequest(
        `https://usebaci.com/api/orders/${orderId}/shipping/checkout-recovery`,
        { method: 'POST', body: 'not-json{' }
      ),
      { params: Promise.resolve({ id: orderId }) }
    );
    expect(response.status).toBe(400);
    expect(mocks.access).not.toHaveBeenCalled();
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
    const response = await request();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Forbidden',
    });
    expect(mocks.quotes).not.toHaveBeenCalled();
  });
  it('rejects manual pins outside Nigeria without a country code', async () => {
    const response = await request({
      action: 'preview',
      receiver: { ...receiver, latitude: 40.7128, longitude: -74.006 },
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error:
        'Manual pins must fall within Nigeria. Search for the address to attach its country.',
    });
    expect(mocks.quotes).not.toHaveBeenCalled();
  });
  it('carries a legacy snake_case postal code into the quote receiver', async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'get_customer_checkout_shipping_recovery_context'
        ? {
            data: {
              ...context,
              order: {
                ...context.order,
                shipping_address: {
                  ...context.order.shipping_address,
                  postal_code: '100001',
                },
              },
            },
            error: null,
          }
        : { data: quoteId, error: null }
    );
    const response = await request();
    expect(response.status).toBe(200);
    const quoted = mocks.quotes.mock.calls[0][1] as {
      receiver: { postalCode?: string };
    };
    expect(quoted.receiver.postalCode).toBe('100001');
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
