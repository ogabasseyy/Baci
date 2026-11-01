import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as csrfModule from '@/lib/csrf';
import type { MerchantContext } from '@/lib/get-merchant-for-api-request';
import { POST } from './route';

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
const ORDER_ID = '123e4567-e89b-12d3-a456-426614174011';
const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174012';
const MERCHANT_B_ID = '123e4567-e89b-12d3-a456-426614174013';
const CUSTOMER_ID = '123e4567-e89b-12d3-a456-426614174014';
const OTHER_CUSTOMER_ID = '123e4567-e89b-12d3-a456-426614174015';
const SESSION_USER_ID = '123e4567-e89b-12d3-a456-426614174016';

const ORDER_ROW = {
  id: ORDER_ID,
  merchant_id: MERCHANT_ID,
  customer_id: CUSTOMER_ID,
};

function buildOwnerCtx(merchantId = MERCHANT_ID): MerchantContext {
  return {
    merchantId,
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

function buildPostRequest(body: unknown, bearer = true): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (bearer) {
    headers.Authorization = 'Bearer test-token';
  }
  return new NextRequest('https://example.com/api/payments/oxygen/attempts', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers,
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

describe('POST /api/payments/oxygen/attempts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureActionRateLimit.mockResolvedValue(true);
    mocks.getMerchantForApiRequest.mockResolvedValue(null);
  });

  it('rate-limits FIRST with the oxygen-initiation bucket', async () => {
    mocks.ensureActionRateLimit.mockResolvedValueOnce(false);
    const supabase = mockProvenCustomer();

    const response = await POST(buildPostRequest({ orderId: ORDER_ID }));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({
      error: 'Too many Oxygen requests. Please try again shortly.',
    });
    expect(mocks.ensureActionRateLimit).toHaveBeenCalledWith(
      'oxygen-initiation',
      { requests: 10, windowMs: 60_000 }
    );
    expect(mocks.authenticateApiRequest).not.toHaveBeenCalled();
    expect(csrfSpy).not.toHaveBeenCalled();
    expect(supabase.client.from).not.toHaveBeenCalled();
    expectNoWrites(supabase.writeSpies);
  });

  it('uses the initiation bucket and never the availability bucket', async () => {
    mockProvenCustomer();

    await POST(buildPostRequest({ orderId: ORDER_ID }));

    expect(mocks.ensureActionRateLimit).toHaveBeenCalledWith(
      'oxygen-initiation',
      expect.anything()
    );
    for (const call of mocks.ensureActionRateLimit.mock.calls) {
      expect(call[0]).not.toBe('oxygen-availability');
    }
  });

  it('rejects a cookie POST without a CSRF token before auth', async () => {
    const supabase = mockProvenCustomer();

    const response = await POST(buildPostRequest({ orderId: ORDER_ID }, false));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: 'Invalid CSRF token',
      message:
        'CSRF token validation failed. Please refresh the page and try again.',
    });
    expect(mocks.authenticateApiRequest).not.toHaveBeenCalled();
    expect(supabase.client.from).not.toHaveBeenCalled();
    expectNoWrites(supabase.writeSpies);
  });

  it('lets a Bearer request past CSRF to the policy verdict', async () => {
    mockProvenCustomer();

    const response = await POST(buildPostRequest({ orderId: ORDER_ID }));
    const body = await response.json();

    expect(csrfSpy).toHaveBeenCalled();
    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: 'Oxygen is not available right now.',
      code: 'oxygen_rollout_disabled',
    });
  });

  it('checks CSRF before parsing the body', async () => {
    mockProvenCustomer();

    const response = await POST(buildPostRequest('{oops', false));

    expect(response.status).toBe(403);
  });

  it('returns 400 for an invalid JSON body before auth', async () => {
    const supabase = mockProvenCustomer();

    const response = await POST(buildPostRequest('{oops'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid JSON body' });
    expect(mocks.authenticateApiRequest).not.toHaveBeenCalled();
    expect(supabase.client.from).not.toHaveBeenCalled();
    expectNoWrites(supabase.writeSpies);
  });

  it.each([
    ['missing orderId', {}],
    ['non-uuid orderId', { orderId: 'not-a-uuid' }],
  ])('returns 400 for %s before auth', async (_label, body) => {
    const supabase = mockProvenCustomer();

    const response = await POST(buildPostRequest(body));
    const parsed = await response.json();

    expect(response.status).toBe(400);
    expect(parsed.error).toBe('Invalid request');
    expect(parsed.details.orderId).toBeDefined();
    expect(Object.keys(parsed).sort()).toEqual(['details', 'error']);
    expect(mocks.authenticateApiRequest).not.toHaveBeenCalled();
    expect(supabase.client.from).not.toHaveBeenCalled();
    expectNoWrites(supabase.writeSpies);
  });

  it('strips unknown body keys and proceeds', async () => {
    mockProvenCustomer();

    const response = await POST(
      buildPostRequest({ orderId: ORDER_ID, injected: 'x' })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe('oxygen_rollout_disabled');
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
      const response = await POST(buildPostRequest({ orderId: ORDER_ID }));
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

      const response = await POST(buildPostRequest({ orderId: ORDER_ID }));
      const body = await response.json();

      expect(response.status, testCase.label).toBe(404);
      expect(body, testCase.label).toEqual({ error: 'Order not found' });
      serialized.push(JSON.stringify(body));
      expectNoWrites(supabase.writeSpies);
    }
    expect(new Set(serialized).size).toBe(1);
  });

  it('denies proven staff on a guest order with the 403 guest message (D1)', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: { ...ORDER_ROW, customer_id: null }, error: null },
      customerResult: { data: null, error: null },
    });
    mockAuthSuccess(supabase.client);
    mocks.getMerchantForApiRequest.mockResolvedValue(buildOwnerCtx());

    const response = await POST(buildPostRequest({ orderId: ORDER_ID }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: 'Sign in to continue with Oxygen.',
      code: 'oxygen_guest_not_allowed',
    });
    expectNoWrites(supabase.writeSpies);
  });

  it('denies a proven customer with the rollout-disabled verdict', async () => {
    const supabase = mockProvenCustomer();

    const response = await POST(buildPostRequest({ orderId: ORDER_ID }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: 'Oxygen is not available right now.',
      code: 'oxygen_rollout_disabled',
    });
    expectNoWrites(supabase.writeSpies);
  });

  it('denies proven staff on a customer order with the rollout verdict', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: ORDER_ROW, error: null },
      customerResult: { data: null, error: null },
    });
    mockAuthSuccess(supabase.client);
    mocks.getMerchantForApiRequest.mockResolvedValue(buildOwnerCtx());

    const response = await POST(buildPostRequest({ orderId: ORDER_ID }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: 'Oxygen is not available right now.',
      code: 'oxygen_rollout_disabled',
    });
    expectNoWrites(supabase.writeSpies);
  });

  it('maps an order load failure to 500 without writes', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: null, error: { message: 'db down' } },
      customerResult: { data: null, error: null },
    });
    mockAuthSuccess(supabase.client);

    const response = await POST(buildPostRequest({ orderId: ORDER_ID }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Unable to load order' });
    expectNoWrites(supabase.writeSpies);
  });

  it('maps a customers lookup failure to 500 instead of masking it as 404', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: ORDER_ROW, error: null },
      customerResult: { data: null, error: { message: 'customers down' } },
    });
    mockAuthSuccess(supabase.client);

    const response = await POST(buildPostRequest({ orderId: ORDER_ID }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Unable to load order' });
    expectNoWrites(supabase.writeSpies);
  });

  it('falls back to 403 when CSRF reports invalid without a response', async () => {
    csrfSpy.mockResolvedValueOnce({ valid: false });

    const response = await POST(buildPostRequest({ orderId: ORDER_ID }));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: 'CSRF validation failed' });
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

    mocks.ensureActionRateLimit.mockResolvedValueOnce(false);
    mockProvenCustomer();
    bodies.push(
      await (await POST(buildPostRequest({ orderId: ORDER_ID }))).json()
    );

    mockProvenCustomer();
    bodies.push(await (await POST(buildPostRequest('{oops'))).json());

    mockProvenCustomer();
    bodies.push(await (await POST(buildPostRequest({}))).json());

    mocks.authenticateApiRequest.mockResolvedValueOnce({
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
    mocks.ensureActionRateLimit.mockResolvedValueOnce(false);
    mockProvenCustomer();
    const limited = await (
      await POST(buildPostRequest({ orderId: ORDER_ID }))
    ).json();
    expect(Object.keys(limited)).toEqual(['error']);

    mocks.authenticateApiRequest.mockResolvedValueOnce({
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

  it('performs no DB writes and reads no env', () => {
    expect(source).not.toMatch(/\b(insert|upsert|update|delete|rpc)\b/);
    expect(source).not.toContain('process.env');
  });

  it('restricts oxygen imports to the two S-05 routes and test files', () => {
    // Repo-wide wiring gate (F1): fails if any third file imports an oxygen
    // module. This test file matches the pattern below and is exempt as a
    // *.test.ts file by construction.
    const srcRoot = resolve(process.cwd(), 'src');
    const roots = [srcRoot];
    const offenders: string[] = [];
    const oxygenImport =
      /oxygen\/(availability|context|initiation)|oxygen-requests/;
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        // Exemptions depend only on the path, so exempt files are skipped
        // before reading: identical offenders list, fewer file reads.
        const relative = full.replace(`${srcRoot}/`, '');
        const isS05Route =
          relative === 'app/api/payments/oxygen/attempts/route.ts' ||
          relative === 'app/api/payments/oxygen/availability/route.ts';
        const isTest = /\.test\.tsx?$/.test(entry.name);
        if (isS05Route || isTest) continue;
        if (!oxygenImport.test(readFileSync(full, 'utf8'))) continue;
        offenders.push(relative);
      }
    };
    for (const root of roots) walk(root);
    expect(offenders).toEqual([]);
    // The walk reads thousands of files; allow headroom on loaded machines.
    // The offenders assertion above is unchanged.
  }, 60_000);
});
