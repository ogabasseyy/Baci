import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as csrfModule from '@/lib/csrf';
import type { MerchantContext } from '@/lib/get-merchant-for-api-request';
import { POST as attemptsPOST } from '../attempts/route';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  ensureActionRateLimit: vi.fn(),
  authenticateApiRequest: vi.fn(),
  getMerchantForApiRequest: vi.fn(),
}));

vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: mocks.ensureActionRateLimit,
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.authenticateApiRequest,
}));

vi.mock('@/lib/get-merchant-for-api-request', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/get-merchant-for-api-request')
  >()),
  getMerchantForApiRequest: mocks.getMerchantForApiRequest,
}));

// Synthetic fixtures only.
const ORDER_ID = '123e4567-e89b-12d3-a456-426614174021';
const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174022';
const MERCHANT_B_ID = '123e4567-e89b-12d3-a456-426614174023';
const CUSTOMER_ID = '123e4567-e89b-12d3-a456-426614174024';
const OTHER_CUSTOMER_ID = '123e4567-e89b-12d3-a456-426614174025';
const SESSION_USER_ID = '123e4567-e89b-12d3-a456-426614174026';

const ORDER_ROW = {
  id: ORDER_ID,
  merchant_id: MERCHANT_ID,
  customer_id: CUSTOMER_ID,
};

function buildOwnerCtx(): MerchantContext {
  return {
    merchantId: MERCHANT_ID,
    staffAccess: {
      isStaff: false,
      isOwner: true,
      role: null,
      permissions: { full_access: { all: true } },
    },
  };
}

function buildDeniedStaffCtx(): MerchantContext {
  return {
    merchantId: MERCHANT_ID,
    staffAccess: {
      isStaff: true,
      isOwner: false,
      role: 'manager',
      permissions: {},
    },
  };
}

interface WriteSpies {
  insert: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
}

function buildSupabaseMock(args: {
  orderResult: { data: unknown; error: unknown };
  customerResult: { data: unknown; error: unknown };
}) {
  const throwing = (name: string) =>
    vi.fn(() => {
      throw new Error(`${name} must not be called`);
    });
  const writeSpies: WriteSpies = {
    insert: throwing('insert'),
    upsert: throwing('upsert'),
    update: throwing('update'),
    delete: throwing('delete'),
    rpc: throwing('rpc'),
  };
  const makeBuilder = (table: string) => {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      single: vi.fn(() =>
        Promise.resolve(
          table === 'orders' ? args.orderResult : args.customerResult
        )
      ),
      maybeSingle: vi.fn(() =>
        Promise.resolve(
          table === 'orders' ? args.orderResult : args.customerResult
        )
      ),
      insert: writeSpies.insert,
      upsert: writeSpies.upsert,
      update: writeSpies.update,
      delete: writeSpies.delete,
    };
    return builder;
  };
  const client = {
    from: vi.fn((table: string) => makeBuilder(table)),
    rpc: writeSpies.rpc,
    auth: {
      getUser: vi.fn(),
      admin: new Proxy(
        {},
        {
          get: () => {
            throw new Error('auth.admin must not be used');
          },
        }
      ),
    },
  };
  return { client, writeSpies };
}

function expectNoWrites(writeSpies: WriteSpies) {
  expect(writeSpies.insert).not.toHaveBeenCalled();
  expect(writeSpies.upsert).not.toHaveBeenCalled();
  expect(writeSpies.update).not.toHaveBeenCalled();
  expect(writeSpies.delete).not.toHaveBeenCalled();
  expect(writeSpies.rpc).not.toHaveBeenCalled();
}

function buildGetRequest(query: string, bearer = true): NextRequest {
  const headers: Record<string, string> = {};
  if (bearer) {
    headers.Authorization = 'Bearer test-token';
  }
  return new NextRequest(
    `https://example.com/api/payments/oxygen/availability${query}`,
    { method: 'GET', headers }
  );
}

function buildPostRequest(body: unknown): NextRequest {
  return new NextRequest('https://example.com/api/payments/oxygen/attempts', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    },
  });
}

function mockAuthSuccess(client: unknown) {
  mocks.authenticateApiRequest.mockResolvedValue({
    user: { id: SESSION_USER_ID },
    error: null,
    supabase: client,
  });
}

function mockProvenCustomer() {
  const supabase = buildSupabaseMock({
    orderResult: { data: ORDER_ROW, error: null },
    customerResult: { data: { id: CUSTOMER_ID }, error: null },
  });
  mockAuthSuccess(supabase.client);
  mocks.getMerchantForApiRequest.mockResolvedValue(null);
  return supabase;
}

const csrfSpy = vi.spyOn(csrfModule, 'checkCsrfProtection');

describe('GET /api/payments/oxygen/availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureActionRateLimit.mockResolvedValue(true);
    mocks.getMerchantForApiRequest.mockResolvedValue(null);
  });

  it('rate-limits FIRST with the oxygen-availability bucket', async () => {
    mocks.ensureActionRateLimit.mockResolvedValueOnce(false);
    const supabase = mockProvenCustomer();

    const response = await GET(buildGetRequest(`?orderId=${ORDER_ID}`));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({
      error: 'Too many Oxygen requests. Please try again shortly.',
    });
    expect(mocks.ensureActionRateLimit).toHaveBeenCalledWith(
      'oxygen-availability',
      { requests: 10, windowMs: 60_000 }
    );
    expect(csrfSpy).not.toHaveBeenCalled();
    expect(mocks.authenticateApiRequest).not.toHaveBeenCalled();
    expect(supabase.client.from).not.toHaveBeenCalled();
    expectNoWrites(supabase.writeSpies);
  });

  it('uses the availability bucket and never the initiation bucket', async () => {
    mockProvenCustomer();

    await GET(buildGetRequest(`?orderId=${ORDER_ID}`));

    expect(mocks.ensureActionRateLimit).toHaveBeenCalledWith(
      'oxygen-availability',
      expect.anything()
    );
    for (const call of mocks.ensureActionRateLimit.mock.calls) {
      expect(call[0]).not.toBe('oxygen-initiation');
    }
  });

  it('calls the CSRF helper though it auto-passes safe methods', async () => {
    mockProvenCustomer();

    const response = await GET(buildGetRequest(`?orderId=${ORDER_ID}`, false));
    const body = await response.json();

    expect(csrfSpy).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(body).toEqual({
      available: false,
      reason: 'oxygen_rollout_disabled',
    });
  });

  it('falls back to 403 when CSRF reports invalid without a response', async () => {
    csrfSpy.mockResolvedValueOnce({ valid: false });

    const response = await GET(buildGetRequest(`?orderId=${ORDER_ID}`, false));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: 'CSRF validation failed' });
  });

  it.each([
    ['missing orderId', ''],
    ['empty orderId', '?orderId='],
    ['non-uuid orderId', '?orderId=not-a-uuid'],
  ])('returns 400 for %s before auth', async (_label, query) => {
    const supabase = mockProvenCustomer();

    const response = await GET(buildGetRequest(query));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request');
    expect(body.details.orderId).toBeDefined();
    expect(Object.keys(body).sort()).toEqual(['details', 'error']);
    expect(mocks.authenticateApiRequest).not.toHaveBeenCalled();
    expect(supabase.client.from).not.toHaveBeenCalled();
    expectNoWrites(supabase.writeSpies);
  });

  it('ignores unknown query params and proceeds', async () => {
    mockProvenCustomer();

    const response = await GET(
      buildGetRequest(`?orderId=${ORDER_ID}&injected=x`)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      available: false,
      reason: 'oxygen_rollout_disabled',
    });
  });

  it('returns a byte-identical 401 for any auth failure, pre-load', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: ORDER_ROW, error: null },
      customerResult: { data: { id: CUSTOMER_ID }, error: null },
    });
    const variants = [
      { user: null, error: 'Invalid or expired token', supabase: null },
      { user: null, error: 'Not authenticated', supabase: null },
      { user: { id: SESSION_USER_ID }, error: null, supabase: null },
      {
        user: null,
        error: 'Authentication failed',
        supabase: supabase.client,
      },
    ];
    const serialized: string[] = [];
    for (const variant of variants) {
      mocks.authenticateApiRequest.mockResolvedValueOnce(variant);
      const response = await GET(buildGetRequest(`?orderId=${ORDER_ID}`));
      const body = await response.json();
      expect(response.status).toBe(401);
      expect(body).toEqual({ error: 'Unauthorized' });
      serialized.push(JSON.stringify(body));
    }
    expect(new Set(serialized).size).toBe(1);
    expect(supabase.client.from).not.toHaveBeenCalled();
    expectNoWrites(supabase.writeSpies);
  });

  it('returns a byte-identical 404 across the full uniformity matrix', async () => {
    const cases: Array<{
      label: string;
      orderResult: { data: unknown; error: unknown };
      customerResult: { data: unknown; error: unknown };
      staffCtx: MerchantContext | null;
    }> = [
      {
        label: 'missing order',
        orderResult: { data: null, error: null },
        customerResult: { data: null, error: null },
        staffCtx: null,
      },
      {
        label: 'guessed UUID of another customer order',
        orderResult: { data: ORDER_ROW, error: null },
        customerResult: { data: null, error: null },
        staffCtx: null,
      },
      {
        label: 'cross-customer session',
        orderResult: { data: ORDER_ROW, error: null },
        customerResult: { data: { id: OTHER_CUSTOMER_ID }, error: null },
        staffCtx: null,
      },
      {
        label: 'cross-merchant order',
        orderResult: {
          data: { ...ORDER_ROW, merchant_id: MERCHANT_B_ID },
          error: null,
        },
        customerResult: { data: null, error: null },
        staffCtx: null,
      },
      {
        label: 'staff denied the orders edit grant',
        orderResult: { data: ORDER_ROW, error: null },
        customerResult: { data: { id: OTHER_CUSTOMER_ID }, error: null },
        staffCtx: buildDeniedStaffCtx(),
      },
      {
        label: 'null-customer order on the customer path',
        orderResult: { data: { ...ORDER_ROW, customer_id: null }, error: null },
        customerResult: { data: { id: CUSTOMER_ID }, error: null },
        staffCtx: null,
      },
    ];
    const serialized: string[] = [];
    for (const testCase of cases) {
      const supabase = buildSupabaseMock(testCase);
      mockAuthSuccess(supabase.client);
      mocks.getMerchantForApiRequest.mockResolvedValue(testCase.staffCtx);

      const response = await GET(buildGetRequest(`?orderId=${ORDER_ID}`));
      const body = await response.json();

      expect(response.status, testCase.label).toBe(404);
      expect(body, testCase.label).toEqual({ error: 'Order not found' });
      serialized.push(JSON.stringify(body));
      expectNoWrites(supabase.writeSpies);
    }
    expect(new Set(serialized).size).toBe(1);
  });

  it('answers proven staff on a guest order with the guest reason (D1)', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: { ...ORDER_ROW, customer_id: null }, error: null },
      customerResult: { data: null, error: null },
    });
    mockAuthSuccess(supabase.client);
    mocks.getMerchantForApiRequest.mockResolvedValue(buildOwnerCtx());

    const response = await GET(buildGetRequest(`?orderId=${ORDER_ID}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      available: false,
      reason: 'oxygen_guest_not_allowed',
    });
    expectNoWrites(supabase.writeSpies);
  });

  it('answers a proven customer with the rollout-disabled verdict', async () => {
    const supabase = mockProvenCustomer();

    const response = await GET(buildGetRequest(`?orderId=${ORDER_ID}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      available: false,
      reason: 'oxygen_rollout_disabled',
    });
    expectNoWrites(supabase.writeSpies);
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

    mocks.ensureActionRateLimit.mockResolvedValueOnce(false);
    mockProvenCustomer();
    bodies.push(
      await (await GET(buildGetRequest(`?orderId=${ORDER_ID}`))).json()
    );

    mockProvenCustomer();
    bodies.push(await (await GET(buildGetRequest(''))).json());

    mocks.authenticateApiRequest.mockResolvedValueOnce({
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
    mocks.ensureActionRateLimit.mockResolvedValueOnce(false);
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

describe('shared-decision consistency at both entry points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureActionRateLimit.mockResolvedValue(true);
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
    mocks.getMerchantForApiRequest.mockResolvedValue(
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
    mocks.getMerchantForApiRequest.mockResolvedValue(null);

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
