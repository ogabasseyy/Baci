import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  proof: vi.fn(),
  rateLimit: vi.fn(),
}));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('@/lib/shipping/shipping-quote-route-proof', () => ({
  createShippingQuoteRouteProof: mocks.proof,
}));
vi.mock('@/lib/tenant-rate-limit', () => ({
  checkTenantRateLimit: mocks.rateLimit,
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
    mocks.rateLimit.mockResolvedValue('allowed');
    mocks.proof.mockReturnValue({ signature: 'fixture-proof' });
  });
  afterEach(() => vi.unstubAllEnvs());

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
});
