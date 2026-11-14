import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPostRequest,
  buildSupabaseMock,
  CUSTOMER_ID,
  expectNoWrites,
  getMocks,
  MERCHANT_ID,
  mockAuthSuccess,
  mockProvenCustomer,
  ORDER_ID,
  POST,
  SESSION_USER_ID,
} from './route.test-helpers';

describe('POST /api/payments/oxygen/attempts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMocks().ensureActionRateLimit.mockResolvedValue(true);
    getMocks().getMerchantForApiRequest.mockResolvedValue(null);
    mockProvenCustomer();
  });
  it('returns identical verdicts with zero writes under parallel load', async () => {
    const supabase = mockProvenCustomer();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        POST(buildPostRequest({ orderId: ORDER_ID }))
      )
    );
    const bodies = await Promise.all(
      responses.map((response) => response.json())
    );

    for (const response of responses) {
      expect(response.status).toBe(403);
    }
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(bodies[0]).toEqual({
      error: 'Oxygen is not available right now.',
      code: 'oxygen_rollout_disabled',
    });
    expectNoWrites(supabase.writeSpies);
  });
  it('echoes no identities in any error body', async () => {
    const ids = [ORDER_ID, MERCHANT_ID, CUSTOMER_ID, SESSION_USER_ID];
    const bodies: unknown[] = [];

    getMocks().ensureActionRateLimit.mockResolvedValueOnce(false);
    mockProvenCustomer();
    bodies.push(
      await (await POST(buildPostRequest({ orderId: ORDER_ID }))).json()
    );

    mockProvenCustomer();
    bodies.push(await (await POST(buildPostRequest('{oops'))).json());

    mockProvenCustomer();
    bodies.push(await (await POST(buildPostRequest({}))).json());

    getMocks().authenticateApiRequest.mockResolvedValueOnce({
      user: null,
      error: 'nope',
      supabase: null,
    });
    bodies.push(
      await (await POST(buildPostRequest({ orderId: ORDER_ID }))).json()
    );

    const missing = buildSupabaseMock({
      orderResult: { data: null, error: null },
      customerResult: { data: null, error: null },
    });
    mockAuthSuccess(missing.client);
    bodies.push(
      await (await POST(buildPostRequest({ orderId: ORDER_ID }))).json()
    );

    mockProvenCustomer();
    bodies.push(
      await (await POST(buildPostRequest({ orderId: ORDER_ID }))).json()
    );

    const failing = buildSupabaseMock({
      orderResult: { data: null, error: { message: 'db down' } },
      customerResult: { data: null, error: null },
    });
    mockAuthSuccess(failing.client);
    bodies.push(
      await (await POST(buildPostRequest({ orderId: ORDER_ID }))).json()
    );

    expect(bodies.length).toBe(7);
    for (const body of bodies) {
      const serialized = JSON.stringify(body);
      for (const id of ids) {
        expect(serialized).not.toContain(id);
      }
    }
  });
  it('returns key-exact error shapes', async () => {
    getMocks().ensureActionRateLimit.mockResolvedValueOnce(false);
    mockProvenCustomer();
    const limited = await (
      await POST(buildPostRequest({ orderId: ORDER_ID }))
    ).json();
    expect(Object.keys(limited)).toEqual(['error']);

    getMocks().authenticateApiRequest.mockResolvedValueOnce({
      user: null,
      error: 'nope',
      supabase: null,
    });
    const unauthorized = await (
      await POST(buildPostRequest({ orderId: ORDER_ID }))
    ).json();
    expect(Object.keys(unauthorized)).toEqual(['error']);

    const missing = buildSupabaseMock({
      orderResult: { data: null, error: null },
      customerResult: { data: null, error: null },
    });
    mockAuthSuccess(missing.client);
    const notFound = await (
      await POST(buildPostRequest({ orderId: ORDER_ID }))
    ).json();
    expect(Object.keys(notFound)).toEqual(['error']);

    const failing = buildSupabaseMock({
      orderResult: { data: null, error: { message: 'db down' } },
      customerResult: { data: null, error: null },
    });
    mockAuthSuccess(failing.client);
    const loadFailed = await (
      await POST(buildPostRequest({ orderId: ORDER_ID }))
    ).json();
    expect(Object.keys(loadFailed)).toEqual(['error']);

    mockProvenCustomer();
    const denied = await (
      await POST(buildPostRequest({ orderId: ORDER_ID }))
    ).json();
    expect(Object.keys(denied).sort()).toEqual(['code', 'error']);
  });
});
describe('attempts route module shape', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/app/api/payments/oxygen/attempts/route.ts'),
    'utf8'
  );
  it('imports the S-03 policy (routes-only side of the wiring gate)', () => {
    expect(source).toContain('oxygen/availability');
  });
  it('never imports provider transport or token cache', () => {
    expect(source).not.toContain('transport');
    expect(source).not.toContain('token-cache');
  });
});
