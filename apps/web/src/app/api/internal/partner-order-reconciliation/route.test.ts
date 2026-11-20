import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  proof: vi.fn(),
  limit: vi.fn(),
}));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('@/lib/shipping/shipping-quote-route-proof', () => ({
  createShippingQuoteRouteProof: mocks.proof,
}));
vi.mock('@/lib/tenant-rate-limit', () => ({
  checkTenantRateLimitDetailed: mocks.limit,
}));

const verifierToken = 'synthetic-verifier-token-with-enough-entropy-for-tests';
const orderToken = 'synthetic-orders-token-with-enough-entropy-for-tests';
const evidence = {
  submission_id: '30000000-0000-4000-8000-000000000001',
  quote_id: '20000000-0000-4000-8000-000000000001',
  partner_order_id: 'external-1',
  capture: {
    source: 'provider',
    provider_account: 'fixture-payment-account',
    reference: 'capture-1',
    amount_minor: 171200,
    currency: 'NGN',
    captured_at: '2026-11-20T15:50:00Z',
  },
  settlement: {
    source: 'payout-provider',
    settlement_account: 'fixture-settlement-account',
    payout_reference: 'payout-1',
    allocation_reference: 'allocation-1',
    amount_minor: 170000,
    currency: 'NGN',
    settled_at: '2026-11-20T15:55:00Z',
  },
};
const receipt = {
  submission_id: evidence.submission_id,
  partner_order_id: evidence.partner_order_id,
  received_at: '2026-11-20T15:51:00Z',
  status: 'accepted',
  order_id: '50000000-0000-4000-8000-000000000001',
};

function request(body: unknown = evidence, token = verifierToken) {
  return new Request(
    'https://example.test/api/internal/partner-order-reconciliation',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }
  );
}

describe('internal partner reconciliation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('CROSSREM_ORDER_TOKEN', orderToken);
    vi.stubEnv('CROSSREM_VERIFIER_TOKEN', verifierToken);
    mocks.limit.mockResolvedValue({ verdict: 'allowed' });
    mocks.proof.mockReturnValue({ signature: 'test-only' });
    mocks.rpc.mockResolvedValue({
      data: { receipt, hold_reason: null },
      error: null,
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it('requires the separate internal verifier credential', async () => {
    expect((await POST(request(evidence, orderToken))).status).toBe(404);
    vi.stubEnv('CROSSREM_VERIFIER_TOKEN', orderToken);
    expect((await POST(request(evidence, orderToken))).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('validates submitted evidence and derives merchant and connection server-side', async () => {
    expect(
      (await POST(request({ ...evidence, merchant_id: 'other-store' }))).status
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ receipt, hold_reason: null });
    const { submission_id, ...expectedEvidence } = evidence;
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      'reconcile_verified_partner_order',
      {
        p_submission_id: submission_id,
        p_merchant_id: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        p_connection_id: 'crossrem-ogabassey',
        p_evidence: expectedEvidence,
        p_route_proof: { signature: 'test-only' },
      }
    );
  });

  it('returns a retry delay when rate limited and fails closed if limiting is unavailable', async () => {
    mocks.limit
      .mockResolvedValueOnce({
        verdict: 'denied',
        resetAt: Date.now() + 15_000,
      })
      .mockResolvedValueOnce({ verdict: 'unavailable' });
    const denied = await POST(request());
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await POST(request())).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    'capture',
    'settlement',
  ] as const)('rejects non-NGN %s evidence before storage', async (section) => {
    const response = await POST(
      request({
        ...evidence,
        [section]: { ...evidence[section], currency: 'USD' },
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects malformed or oversized JSON before accessing storage', async () => {
    const malformed = new Request(request().url, {
      method: 'POST',
      headers: { authorization: `Bearer ${verifierToken}` },
      body: '{',
    });
    expect((await POST(malformed)).status).toBe(400);
    expect((await POST(request('x'.repeat(8193)))).status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['P0002', 404, 'NOT_FOUND'],
    ['22023', 409, 'CAPTURE_EVIDENCE_CONFLICT'],
    ['23505', 409, 'CAPTURE_EVIDENCE_CONFLICT'],
  ])('maps storage error %s without issuing a success receipt', async (code, status, responseCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code } });
    const result = await POST(request());
    expect(result.status).toBe(status);
    expect(await result.json()).toMatchObject({
      error: { code: responseCode },
    });
  });

  it('returns a held receipt without reporting order acceptance', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        receipt: {
          ...receipt,
          status: 'review_required',
          review_reason: 'ORDER_REVIEW_REQUIRED',
        },
        hold_reason: 'ORDER_REVIEW_REQUIRED',
      },
      error: null,
    });
    const result = await POST(request());
    expect(result.status).toBe(202);
    const body = await result.json();
    expect(body).toMatchObject({
      receipt: {
        status: 'review_required',
        review_reason: 'ORDER_REVIEW_REQUIRED',
      },
      hold_reason: 'ORDER_REVIEW_REQUIRED',
    });
    expect(body.receipt).not.toHaveProperty('order_id');
  });
});
