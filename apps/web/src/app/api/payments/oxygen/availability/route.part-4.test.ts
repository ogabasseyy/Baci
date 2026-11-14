import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attemptsPOST,
  buildGetRequest,
  buildOwnerCtx,
  buildPostRequest,
  buildSupabaseMock,
  CUSTOMER_ID,
  expectNoWrites,
  GET,
  getMocks,
  mockAuthSuccess,
  ORDER_ID,
  ORDER_ROW,
} from './route.test-helpers';

describe('shared-decision consistency at both entry points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMocks().distributedRateLimit.mockResolvedValue({ allowed: true });
  });
  it.each([
    ['proven customer', 'oxygen_rollout_disabled'],
    ['proven staff on a guest order', 'oxygen_guest_not_allowed'],
  ])('agrees on %s', async (_label, reason) => {
    const guest = reason === 'oxygen_guest_not_allowed';
    const supabase = buildSupabaseMock({
      orderResult: {
        data: guest ? { ...ORDER_ROW, customer_id: null } : ORDER_ROW,
        error: null,
      },
      customerResult: guest
        ? { data: null, error: null }
        : { data: { id: CUSTOMER_ID }, error: null },
    });
    mockAuthSuccess(supabase.client);
    getMocks().getMerchantForApiRequest.mockResolvedValue(
      guest ? buildOwnerCtx() : null
    );

    const postResponse = await attemptsPOST(
      buildPostRequest({ orderId: ORDER_ID })
    );
    const getResponse = await GET(buildGetRequest(`?orderId=${ORDER_ID}`));
    const postBody = await postResponse.json();
    const getBody = await getResponse.json();

    expect(postResponse.status).toBe(403);
    expect(postBody.code).toBe(reason);
    expect(getResponse.status).toBe(200);
    expect(getBody).toEqual({ available: false, reason });
    expectNoWrites(supabase.writeSpies);
  });
  it('agrees on missing orders at both entry points', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: null, error: null },
      customerResult: { data: null, error: null },
    });
    mockAuthSuccess(supabase.client);
    getMocks().getMerchantForApiRequest.mockResolvedValue(null);

    const postBody = await (
      await attemptsPOST(buildPostRequest({ orderId: ORDER_ID }))
    ).json();
    const getBody = await (
      await GET(buildGetRequest(`?orderId=${ORDER_ID}`))
    ).json();

    expect(postBody).toEqual({ error: 'Order not found' });
    expect(getBody).toEqual({ error: 'Order not found' });
  });
});
describe('availability route module shape', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/app/api/payments/oxygen/availability/route.ts'),
    'utf8'
  );
  it('imports the S-03 policy (routes-only side of the wiring gate)', () => {
    expect(source).toContain('oxygen/availability');
  });
  it('never imports provider transport or token cache', () => {
    expect(source).not.toContain('transport');
    expect(source).not.toContain('token-cache');
  });
  it('performs no DB writes and reads no env', () => {
    expect(source).not.toMatch(/\b(insert|upsert|update|delete|rpc)\b/);
    expect(source).not.toContain('process.env');
  });
});
