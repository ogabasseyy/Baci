import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  proof: vi.fn(),
  rateLimit: vi.fn(),
  after: vi.fn<(callback: () => Promise<void>) => void>(),
  capture: vi.fn(),
}));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('@/lib/shipping/shipping-quote-route-proof', () => ({
  createShippingQuoteRouteProof: mocks.proof,
}));
vi.mock('@/lib/tenant-rate-limit', () => ({
  checkTenantRateLimitDetailed: mocks.rateLimit,
}));

const orderToken = 'synthetic-orders-token-with-enough-entropy-for-tests';
const quoteToken = 'synthetic-quotes-token-with-enough-entropy-for-tests';
const orderId = '20000000-0000-4000-8000-000000000003';

function request(token = orderToken, id = orderId) {
  return GET(
    new Request(`https://example.test/api/partners/v1/orders/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ orderId: id }) }
  );
}

describe('partner tracking lookup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('CROSSREM_ORDER_TOKEN', orderToken);
    vi.stubEnv('CROSSREM_QUOTE_TOKEN', quoteToken);
    mocks.rateLimit.mockResolvedValue({ verdict: 'allowed' });
    mocks.proof.mockReturnValue({ signature: 'fixture-proof' });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('distinguishes an invalid database response from temporary unavailability', async () => {
    mocks.rpc.mockResolvedValue({ data: { unexpected: true }, error: null });

    const response = await request();

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: { code: 'ORDER_RESPONSE_INVALID' },
    });
  });

  it('sets Retry-After on a rate-limited request without accessing storage', async () => {
    mocks.rateLimit.mockResolvedValueOnce({ verdict: 'denied' });

    const response = await request();

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('returns the scoped order status and waybill without recipient data', async () => {
    const order = {
      order_id: orderId,
      partner_order_id: 'partner-1',
      payment_status: 'paid',
      shipping_status: 'shipped',
      tracking: { provider: 'GIGL', tracking_number: 'TEST-WAYBILL' },
    };
    mocks.rpc.mockResolvedValue({
      data: { ...order, customer_phone: 'private' },
      error: null,
    });
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject(order);
    expect(body).not.toHaveProperty('customer_phone');
    expect(mocks.rpc).toHaveBeenCalledWith(
      'read_partner_order_tracking',
      expect.objectContaining({
        p_order_id: orderId,
        p_connection_id: 'crossrem-ogabassey',
      })
    );
  });

  it('returns 404 for inaccessible orders and validates access before calling storage', async () => {
    expect((await request(quoteToken)).status).toBe(403);
    expect((await request(orderToken, 'bad-order-id')).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await request()).status).toBe(404);
  });

  it('logs tracking status drift without including the raw status', async () => {
    using warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({
      data: {
        order_id: orderId,
        partner_order_id: 'partner-1',
        payment_status: 'paid',
        shipping_status: 'private-status',
        tracking: null,
      },
      error: null,
    });
    const response = await request();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      payment_status: 'paid',
      shipping_status: 'unknown',
    });
    expect(warn).toHaveBeenCalledExactlyOnceWith({
      message: 'Unrecognized partner tracking status',
      connectionId: 'crossrem-ogabassey',
      requestId: body.request_id,
      paymentStatusUnknown: false,
      shippingStatusUnknown: true,
    });
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.after.mock.calls[0]?.[0]();
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(
      'partner_tracking_status_unknown',
      { payment_status_unknown: false, shipping_status_unknown: true }
    );
  });
  it('reports server proof rejection without exposing database details', async () => {
    using log = vi.spyOn(logger, 'error').mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'private error' },
    });
    const response = await request();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      error: { code: 'ORDER_LOOKUP_UNAVAILABLE' },
      request_id: expect.any(String),
    });
    expect(log).toHaveBeenCalledExactlyOnceWith({
      message: 'Partner tracking database authorization rejected',
      connectionId: 'crossrem-ogabassey',
      requestId: body.request_id,
    });
  });
});
