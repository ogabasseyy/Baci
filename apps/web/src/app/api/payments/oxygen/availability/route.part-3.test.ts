import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildGetRequest,
  buildSupabaseMock,
  CUSTOMER_ID,
  expectNoWrites,
  GET,
  getMocks,
  MERCHANT_ID,
  mockAuthSuccess,
  mockProvenCustomer,
  ORDER_ID,
  SESSION_USER_ID,
} from './route.test-helpers';

describe('GET /api/payments/oxygen/availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMocks().distributedRateLimit.mockResolvedValue({ allowed: true });
    getMocks().getMerchantForApiRequest.mockResolvedValue(null);
    mockProvenCustomer();
  });
  it('maps an order load failure to 500 without writes', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: null, error: { message: 'db down' } },
      customerResult: { data: null, error: null },
    });
    mockAuthSuccess(supabase.client);

    const response = await GET(buildGetRequest(`?orderId=${ORDER_ID}`));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Unable to load order' });
    expectNoWrites(supabase.writeSpies);
  });
  it('returns identical verdicts with zero writes under parallel load', async () => {
    const supabase = mockProvenCustomer();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        GET(buildGetRequest(`?orderId=${ORDER_ID}`))
      )
    );
    const bodies = await Promise.all(
      responses.map((response) => response.json())
    );

    for (const response of responses) {
      expect(response.status).toBe(200);
    }
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(bodies[0]).toEqual({
      available: false,
      reason: 'oxygen_rollout_disabled',
    });
    expectNoWrites(supabase.writeSpies);
  });
  it('echoes no identities and no order details in any body', async () => {
    const ids = [ORDER_ID, MERCHANT_ID, CUSTOMER_ID, SESSION_USER_ID];
    const bodies: unknown[] = [];

    getMocks().distributedRateLimit.mockResolvedValueOnce({ allowed: false });
    mockProvenCustomer();
    bodies.push(
      await (await GET(buildGetRequest(`?orderId=${ORDER_ID}`))).json()
    );

    mockProvenCustomer();
    bodies.push(await (await GET(buildGetRequest(''))).json());

    getMocks().authenticateApiRequest.mockResolvedValueOnce({
      user: null,
      error: 'nope',
      supabase: null,
    });
    bodies.push(
      await (await GET(buildGetRequest(`?orderId=${ORDER_ID}`))).json()
    );

    const missing = buildSupabaseMock({
      orderResult: { data: null, error: null },
      customerResult: { data: null, error: null },
    });
    mockAuthSuccess(missing.client);
    bodies.push(
      await (await GET(buildGetRequest(`?orderId=${ORDER_ID}`))).json()
    );

    mockProvenCustomer();
    bodies.push(
      await (await GET(buildGetRequest(`?orderId=${ORDER_ID}`))).json()
    );

    const failing = buildSupabaseMock({
      orderResult: { data: null, error: { message: 'db down' } },
      customerResult: { data: null, error: null },
    });
    mockAuthSuccess(failing.client);
    bodies.push(
      await (await GET(buildGetRequest(`?orderId=${ORDER_ID}`))).json()
    );

    expect(bodies.length).toBe(6);
    for (const body of bodies) {
      const serialized = JSON.stringify(body);
      for (const id of ids) {
        expect(serialized).not.toContain(id);
      }
    }
  });
  it('returns key-exact shapes', async () => {
    getMocks().distributedRateLimit.mockResolvedValueOnce({ allowed: false });
    mockProvenCustomer();
    const limited = await (
      await GET(buildGetRequest(`?orderId=${ORDER_ID}`))
    ).json();
    expect(Object.keys(limited)).toEqual(['error']);

    const missing = buildSupabaseMock({
      orderResult: { data: null, error: null },
      customerResult: { data: null, error: null },
    });
    mockAuthSuccess(missing.client);
    const notFound = await (
      await GET(buildGetRequest(`?orderId=${ORDER_ID}`))
    ).json();
    expect(Object.keys(notFound)).toEqual(['error']);

    mockProvenCustomer();
    const denied = await (
      await GET(buildGetRequest(`?orderId=${ORDER_ID}`))
    ).json();
    expect(Object.keys(denied).sort()).toEqual(['available', 'reason']);
  });
});
