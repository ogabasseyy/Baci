import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

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
const idempotencyKey = 'synthetic-order-attempt-key';
const input = {
  quote_id: '20000000-0000-4000-8000-000000000001',
  partner_order_id: 'external-reference-1',
  recipient: { name: 'Test Recipient', phone: '+2348000000000' },
  payment: {
    reference: 'reference-one',
    source: 'crossrem',
    amount_minor: 171200,
    currency: 'NGN',
  },
};
const receipt = {
  submission_id: '20000000-0000-4000-8000-000000000002',
  partner_order_id: input.partner_order_id,
  received_at: '2026-11-20T15:00:00+00:00',
  status: 'pending_verification',
};

function request(
  body: unknown = input,
  token = orderToken,
  key = idempotencyKey
) {
  return new Request('https://example.test/api/partners/v1/orders', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
}

describe('partner order intake', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('CROSSREM_ORDER_TOKEN', orderToken);
    vi.stubEnv('CROSSREM_QUOTE_TOKEN', quoteToken);
    mocks.rateLimit.mockResolvedValue('allowed');
    mocks.proof.mockReturnValue({ signature: 'fixture-proof' });
    mocks.rpc.mockResolvedValue({ data: receipt, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects oversized bodies before doing any partner work', async () => {
    const response = await POST(request('x'.repeat(8193)));
    expect(response.status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('accepts the request example published in the partner quickstart', async () => {
    const guide = readFileSync(
      new URL(
        '../../../../../../../../docs/partners/delivery-api-quickstart.md',
        import.meta.url
      ),
      'utf8'
    );
    const examples = guide
      .split('```')
      .filter((block) => block.startsWith('json'));
    const example = JSON.parse(examples[1].slice(4).trim());
    expect((await POST(request(example))).status).toBe(202);
  });

  it('returns 202 only after storing a scoped receipt and hashes the idempotency key', async () => {
    const result = await POST(request());
    expect(result.status).toBe(202);
    expect(await result.json()).toMatchObject(receipt);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('submit_partner_order', {
      p_quote_id: input.quote_id,
      p_merchant_id: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      p_connection_id: 'crossrem-ogabassey',
      p_partner_order_id: input.partner_order_id,
      p_idempotency_hash: createHash('sha256')
        .update(idempotencyKey)
        .digest('hex'),
      p_submission: { recipient: input.recipient, payment: input.payment },
      p_route_proof: { signature: 'fixture-proof' },
    });
  });

  it('returns the accepted order on a replay after reconciliation', async () => {
    const order_id = '20000000-0000-4000-8000-000000000003';
    mocks.rpc.mockResolvedValue({
      data: { ...receipt, status: 'accepted', order_id },
      error: null,
    });
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ status: 'accepted', order_id });
  });

  it('rejects quote-only access, missing idempotency key, and extra payment status', async () => {
    expect((await POST(request(input, quoteToken))).status).toBe(403);
    expect((await POST(request(input, orderToken, ''))).status).toBe(400);
    expect(
      (
        await POST(
          request({ ...input, payment: { ...input.payment, verified: true } })
        )
      ).status
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('maps quote ownership and immutable submission conflicts without reporting success', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { code: 'P0002' }, data: null });
    mocks.rpc.mockResolvedValueOnce({ error: { code: '23505' }, data: null });
    mocks.rpc.mockResolvedValueOnce({ error: { code: '42501' }, data: null });
    expect((await POST(request())).status).toBe(404);
    expect((await POST(request())).status).toBe(409);
    expect((await POST(request())).status).toBe(503);
  });
});
