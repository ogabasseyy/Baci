import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
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
  checkTenantRateLimitDetailed: mocks.rateLimit,
}));

const orderToken = 'synthetic-orders-token-with-enough-entropy-for-tests';
const quoteToken = 'synthetic-quotes-token-with-enough-entropy-for-tests';
const receipt = {
  submission_id: '20000000-0000-4000-8000-000000000002',
  partner_order_id: 'external-reference-1',
  received_at: '2026-11-20T15:00:00+00:00',
  status: 'pending_verification',
};

function request(
  query = '?partner_order_id=external-reference-1',
  token = orderToken
) {
  return new Request(
    `https://example.test/api/partners/v1/order-submissions${query}`,
    {
      headers: { authorization: `Bearer ${token}` },
    }
  );
}

describe('partner order submission lookup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('CROSSREM_ORDER_TOKEN', orderToken);
    vi.stubEnv('CROSSREM_QUOTE_TOKEN', quoteToken);
    mocks.rateLimit.mockResolvedValue({ verdict: 'allowed' });
    mocks.proof.mockReturnValue({ signature: 'fixture-proof' });
    mocks.rpc.mockResolvedValue({ data: receipt, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects duplicate order references without querying storage', async () => {
    const response = await GET(
      request('?partner_order_id=first&partner_order_id=second')
    );
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('distinguishes an invalid database response from temporary unavailability', async () => {
    mocks.rpc.mockResolvedValue({ data: { unexpected: true }, error: null });

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: { code: 'ORDER_RESPONSE_INVALID' },
    });
  });

  it('sets Retry-After on a rate-limited request without accessing storage', async () => {
    mocks.rateLimit.mockResolvedValueOnce({ verdict: 'denied' });

    const response = await GET(request());

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('returns the receipt scoped to the connection and takes no merchant override', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(receipt);
    expect(
      (
        await GET(
          request('?partner_order_id=external-reference-1&merchant_id=other')
        )
      ).status
    ).toBe(400);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      'read_partner_order_submission',
      {
        p_merchant_id: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        p_request_id: expect.any(String),
        p_connection_id: 'crossrem-ogabassey',
        p_partner_order_id: 'external-reference-1',
        p_route_proof: { signature: 'fixture-proof' },
      }
    );
  });

  it('surfaces verified capture separately from order acceptance', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ...receipt,
        status: 'payment_verified',
        payment_reference: 'private-ref',
      },
      error: null,
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('payment_verified');
    expect(body).not.toHaveProperty('payment_reference');
    expect(body).not.toHaveProperty('order_id');
  });

  it('requires order access and returns 404 when the scoped lookup is empty', async () => {
    expect((await GET(request(undefined, quoteToken))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await GET(request())).status).toBe(404);
  });
  it('reports server proof rejection without exposing database details', async () => {
    using log = vi.spyOn(logger, 'error').mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'private error' },
    });
    const response = await GET(request());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      error: { code: 'ORDER_LOOKUP_UNAVAILABLE' },
      request_id: expect.any(String),
    });
    expect(log).toHaveBeenCalledExactlyOnceWith({
      message: 'Partner order lookup database authorization rejected',
      connectionId: 'crossrem-ogabassey',
      requestId: body.request_id,
    });
  });
});
