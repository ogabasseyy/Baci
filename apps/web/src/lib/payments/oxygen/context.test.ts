import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MerchantContext } from '@/lib/get-merchant-for-api-request';
import {
  type OxygenOrderRow,
  proveOxygenOrderAccess,
  resolveOxygenOrderContext,
} from './context';

const mocks = vi.hoisted(() => ({
  getMerchantForApiRequest: vi.fn(),
}));

vi.mock('@/lib/get-merchant-for-api-request', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/get-merchant-for-api-request')
  >()),
  getMerchantForApiRequest: mocks.getMerchantForApiRequest,
}));

// Synthetic fixtures only. SESSION_USER_ID (auth id space) is deliberately
// distinct from CUSTOMER_ID (customers id space): F1 forbids comparing a
// session id to order.customer_id directly.
const ORDER_ID = '123e4567-e89b-12d3-a456-426614174001';
const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174002';
const CUSTOMER_ID = '123e4567-e89b-12d3-a456-426614174003';
const SESSION_USER_ID = '123e4567-e89b-12d3-a456-426614174004';
const OTHER_CUSTOMER_ID = '123e4567-e89b-12d3-a456-426614174005';
const OTHER_MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174006';

function buildOrderRow(
  overrides: Partial<OxygenOrderRow> = {}
): OxygenOrderRow {
  return {
    id: ORDER_ID,
    merchant_id: MERCHANT_ID,
    customer_id: CUSTOMER_ID,
    ...overrides,
  };
}

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

function buildStaffCtx(
  permissions: Record<string, Record<string, boolean>>,
  merchantId = MERCHANT_ID
): MerchantContext {
  return {
    merchantId,
    staffAccess: {
      isStaff: true,
      isOwner: false,
      role: 'manager',
      permissions,
    },
  };
}

interface QueryCall {
  table: string;
  selectArg: string;
  eqArgs: [string, string][];
  terminal: 'single' | 'maybeSingle' | null;
}

function buildSupabaseMock(args: {
  orderResult: { data: unknown; error: unknown };
  customerResult: { data: unknown; error: unknown };
}) {
  const calls: QueryCall[] = [];
  const from = vi.fn((table: string) => {
    const call: QueryCall = {
      table,
      selectArg: '',
      eqArgs: [],
      terminal: null,
    };
    calls.push(call);
    const builder = {
      select: vi.fn((selectArg: string) => {
        call.selectArg = selectArg;
        return builder;
      }),
      eq: vi.fn((column: string, value: string) => {
        call.eqArgs.push([column, value]);
        return builder;
      }),
      single: vi.fn(() => {
        call.terminal = 'single';
        return Promise.resolve(
          table === 'orders' ? args.orderResult : args.customerResult
        );
      }),
      maybeSingle: vi.fn(() => {
        call.terminal = 'maybeSingle';
        return Promise.resolve(
          table === 'orders' ? args.orderResult : args.customerResult
        );
      }),
    };
    return builder;
  });
  return { from, calls };
}

function expectedDeploymentEnvironment(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
}

describe('resolveOxygenOrderContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMerchantForApiRequest.mockResolvedValue(null);
  });

  it('resolves the customer path with a pinned S-03 input', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: buildOrderRow(), error: null },
      customerResult: { data: { id: CUSTOMER_ID }, error: null },
    });
    const env = expectedDeploymentEnvironment();

    const result = await resolveOxygenOrderContext(
      supabase as never,
      ORDER_ID,
      SESSION_USER_ID
    );

    expect(result).toEqual({
      ok: true,
      order: buildOrderRow(),
      customerRow: { id: CUSTOMER_ID },
      staffCtx: null,
      s03input: {
        merchant: { id: MERCHANT_ID },
        customer: { id: CUSTOMER_ID },
        order: { id: ORDER_ID, merchantId: MERCHANT_ID },
        environment: env,
        expectedEnvironment: env,
        policy: { guestInitiationsAllowed: false },
        rollout: { newInitiationsEnabled: false },
        providerReadiness: { verified: false },
      },
    });
  });

  it('pins the environment pair equal by construction', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: buildOrderRow(), error: null },
      customerResult: { data: { id: CUSTOMER_ID }, error: null },
    });

    const result = await resolveOxygenOrderContext(
      supabase as never,
      ORDER_ID,
      SESSION_USER_ID
    );

    expect(result).toMatchObject({ ok: true });
    if ('denied' in result) throw new Error('expected ok');
    expect(result.s03input.environment).toBe(
      result.s03input.expectedEnvironment
    );
    expect(result.s03input.environment).toBe(expectedDeploymentEnvironment());
  });

  it('queries the exact order columns (no status column exists)', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: buildOrderRow(), error: null },
      customerResult: { data: { id: CUSTOMER_ID }, error: null },
    });

    await resolveOxygenOrderContext(
      supabase as never,
      ORDER_ID,
      SESSION_USER_ID
    );

    const orderCall = supabase.calls.find((call) => call.table === 'orders');
    expect(orderCall?.selectArg).toBe('id, merchant_id, customer_id');
    expect(orderCall?.eqArgs).toEqual([['id', ORDER_ID]]);
    expect(orderCall?.terminal).toBe('maybeSingle');
  });

  it('looks up the customer row scoped to order merchant + session user', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: buildOrderRow(), error: null },
      customerResult: { data: { id: CUSTOMER_ID }, error: null },
    });

    await resolveOxygenOrderContext(
      supabase as never,
      ORDER_ID,
      SESSION_USER_ID
    );

    const customerCall = supabase.calls.find(
      (call) => call.table === 'customers'
    );
    expect(customerCall?.selectArg).toBe('id');
    expect(customerCall?.eqArgs).toEqual([
      ['merchant_id', MERCHANT_ID],
      ['user_id', SESSION_USER_ID],
    ]);
    expect(customerCall?.terminal).toBe('maybeSingle');
  });

  it('scopes the staff lookup to the order merchant (no false 404s)', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: buildOrderRow(), error: null },
      customerResult: { data: { id: CUSTOMER_ID }, error: null },
    });

    await resolveOxygenOrderContext(
      supabase as never,
      ORDER_ID,
      SESSION_USER_ID
    );

    expect(mocks.getMerchantForApiRequest).toHaveBeenCalledWith(
      supabase,
      SESSION_USER_ID,
      { requestedMerchantId: MERCHANT_ID }
    );
  });

  it('denies when the order has zero rows without further I/O', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: null, error: null },
      customerResult: { data: null, error: { message: 'unused' } },
    });

    const result = await resolveOxygenOrderContext(
      supabase as never,
      ORDER_ID,
      SESSION_USER_ID
    );

    expect(result).toEqual({ denied: true });
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(mocks.getMerchantForApiRequest).not.toHaveBeenCalled();
  });

  it('propagates order DB errors for the route to map to 500', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: null, error: { message: 'db down' } },
      customerResult: { data: null, error: null },
    });

    await expect(
      resolveOxygenOrderContext(supabase as never, ORDER_ID, SESSION_USER_ID)
    ).rejects.toMatchObject({ message: 'db down' });
  });

  it('propagates customers DB errors instead of masking them as 404', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: buildOrderRow(), error: null },
      customerResult: { data: null, error: { message: 'customers down' } },
    });

    await expect(
      resolveOxygenOrderContext(supabase as never, ORDER_ID, SESSION_USER_ID)
    ).rejects.toMatchObject({ message: 'customers down' });
  });

  it('denies when the customers lookup has zero rows', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: buildOrderRow(), error: null },
      customerResult: { data: null, error: null },
    });

    const result = await resolveOxygenOrderContext(
      supabase as never,
      ORDER_ID,
      SESSION_USER_ID
    );

    expect(result).toEqual({ denied: true });
  });

  it('denies a cross-customer order when staff is absent', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: buildOrderRow(), error: null },
      customerResult: { data: { id: OTHER_CUSTOMER_ID }, error: null },
    });

    const result = await resolveOxygenOrderContext(
      supabase as never,
      ORDER_ID,
      SESSION_USER_ID
    );

    expect(result).toEqual({ denied: true });
  });

  it('falls back to the staff path when the customer row is missing', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValue(buildOwnerCtx());
    const supabase = buildSupabaseMock({
      orderResult: { data: buildOrderRow(), error: null },
      customerResult: { data: null, error: null },
    });
    const env = expectedDeploymentEnvironment();

    const result = await resolveOxygenOrderContext(
      supabase as never,
      ORDER_ID,
      SESSION_USER_ID
    );

    expect(result).toEqual({
      ok: true,
      order: buildOrderRow(),
      customerRow: null,
      staffCtx: buildOwnerCtx(),
      s03input: {
        merchant: { id: MERCHANT_ID },
        customer: { id: CUSTOMER_ID },
        order: { id: ORDER_ID, merchantId: MERCHANT_ID },
        environment: env,
        expectedEnvironment: env,
        policy: { guestInitiationsAllowed: false },
        rollout: { newInitiationsEnabled: false },
        providerReadiness: { verified: false },
      },
    });
  });

  it('denies when both the customer row is missing and staff is absent', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: buildOrderRow(), error: null },
      customerResult: { data: null, error: null },
    });

    const result = await resolveOxygenOrderContext(
      supabase as never,
      ORDER_ID,
      SESSION_USER_ID
    );

    expect(result).toEqual({ denied: true });
  });

  it('denies staff without the orders edit grant (rule mock-free)', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValue(buildStaffCtx({}));
    const supabase = buildSupabaseMock({
      orderResult: { data: buildOrderRow(), error: null },
      customerResult: { data: { id: OTHER_CUSTOMER_ID }, error: null },
    });

    const result = await resolveOxygenOrderContext(
      supabase as never,
      ORDER_ID,
      SESSION_USER_ID
    );

    expect(result).toEqual({ denied: true });
  });

  it('allows staff holding the orders edit grant on a foreign-customer order', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValue(
      buildStaffCtx({ orders: { edit: true } })
    );
    const supabase = buildSupabaseMock({
      orderResult: { data: buildOrderRow(), error: null },
      customerResult: { data: { id: OTHER_CUSTOMER_ID }, error: null },
    });

    const result = await resolveOxygenOrderContext(
      supabase as never,
      ORDER_ID,
      SESSION_USER_ID
    );

    expect(result).toMatchObject({ ok: true });
    if ('denied' in result) throw new Error('expected ok');
    expect(result.s03input.customer).toEqual({ id: CUSTOMER_ID });
  });

  it('denies a guest (null-customer) order on the customer path', async () => {
    const supabase = buildSupabaseMock({
      orderResult: { data: buildOrderRow({ customer_id: null }), error: null },
      customerResult: { data: { id: CUSTOMER_ID }, error: null },
    });

    const result = await resolveOxygenOrderContext(
      supabase as never,
      ORDER_ID,
      SESSION_USER_ID
    );

    expect(result).toEqual({ denied: true });
  });

  it('resolves proven staff on a guest order with a null S-03 customer (D1)', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValue(buildOwnerCtx());
    const supabase = buildSupabaseMock({
      orderResult: { data: buildOrderRow({ customer_id: null }), error: null },
      customerResult: { data: null, error: null },
    });

    const result = await resolveOxygenOrderContext(
      supabase as never,
      ORDER_ID,
      SESSION_USER_ID
    );

    expect(result).toMatchObject({ ok: true });
    if ('denied' in result) throw new Error('expected ok');
    expect(result.s03input.customer).toBeNull();
    expect(result.s03input.merchant).toEqual({ id: MERCHANT_ID });
  });

  it('uses the staff merchant on the staff path', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValue(
      buildOwnerCtx(OTHER_MERCHANT_ID)
    );
    const supabase = buildSupabaseMock({
      orderResult: {
        data: buildOrderRow({ merchant_id: OTHER_MERCHANT_ID }),
        error: null,
      },
      customerResult: { data: null, error: null },
    });

    const result = await resolveOxygenOrderContext(
      supabase as never,
      ORDER_ID,
      SESSION_USER_ID
    );

    expect(result).toMatchObject({ ok: true });
    if ('denied' in result) throw new Error('expected ok');
    expect(result.s03input.merchant).toEqual({ id: OTHER_MERCHANT_ID });
  });
});

describe('proveOxygenOrderAccess (pure)', () => {
  it('proves the customer path on exact customer-row match', () => {
    expect(
      proveOxygenOrderAccess({
        order: buildOrderRow(),
        customerRow: { id: CUSTOMER_ID },
        staffCtx: null,
      })
    ).toEqual({ proven: true, path: 'customer' });
  });

  it('denies when the customer row differs and staff is absent', () => {
    expect(
      proveOxygenOrderAccess({
        order: buildOrderRow(),
        customerRow: { id: OTHER_CUSTOMER_ID },
        staffCtx: null,
      })
    ).toEqual({ proven: false });
  });

  it('never compares a session id to order.customer_id (F1)', () => {
    // prove takes no session id at all: a single args object only.
    expect(proveOxygenOrderAccess.length).toBe(1);
    // A customer row carrying the *session* id still denies when it is not
    // the order customer: only customerRow.id === order.customer_id proves.
    expect(
      proveOxygenOrderAccess({
        order: buildOrderRow(),
        customerRow: { id: SESSION_USER_ID },
        staffCtx: null,
      })
    ).toEqual({ proven: false });
  });

  it('proves the staff path for an owner on a foreign-customer order', () => {
    expect(
      proveOxygenOrderAccess({
        order: buildOrderRow(),
        customerRow: { id: OTHER_CUSTOMER_ID },
        staffCtx: buildOwnerCtx(),
      })
    ).toEqual({ proven: true, path: 'staff' });
  });

  it('proves the staff path for staff with the orders edit grant', () => {
    expect(
      proveOxygenOrderAccess({
        order: buildOrderRow(),
        customerRow: null,
        staffCtx: buildStaffCtx({ orders: { edit: true } }),
      })
    ).toEqual({ proven: true, path: 'staff' });
  });

  it('denies staff without the orders edit grant', () => {
    expect(
      proveOxygenOrderAccess({
        order: buildOrderRow(),
        customerRow: null,
        staffCtx: buildStaffCtx({}),
      })
    ).toEqual({ proven: false });
  });

  it('prefers the customer path when both paths are valid', () => {
    expect(
      proveOxygenOrderAccess({
        order: buildOrderRow(),
        customerRow: { id: CUSTOMER_ID },
        staffCtx: buildOwnerCtx(),
      })
    ).toEqual({ proven: true, path: 'customer' });
  });

  it('denies a guest order without staff and proves it with staff', () => {
    const guestOrder = buildOrderRow({ customer_id: null });
    expect(
      proveOxygenOrderAccess({
        order: guestOrder,
        customerRow: { id: CUSTOMER_ID },
        staffCtx: null,
      })
    ).toEqual({ proven: false });
    expect(
      proveOxygenOrderAccess({
        order: guestOrder,
        customerRow: null,
        staffCtx: buildOwnerCtx(),
      })
    ).toEqual({ proven: true, path: 'staff' });
  });

  it('denies when nothing proves', () => {
    expect(
      proveOxygenOrderAccess({
        order: buildOrderRow(),
        customerRow: null,
        staffCtx: null,
      })
    ).toEqual({ proven: false });
  });
});

describe('context module shape', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/lib/payments/oxygen/context.ts'),
    'utf8'
  );

  it('does not import the S-03 policy (routes-only import, D5)', () => {
    expect(source).not.toContain('availability');
  });

  it('never imports provider transport or token cache', () => {
    expect(source).not.toContain('transport');
    expect(source).not.toContain('token-cache');
  });

  it('performs no DB writes', () => {
    expect(source).not.toMatch(/\b(insert|upsert|update|delete|rpc)\b/);
  });

  it('reads process.env only inside the single private resolver', () => {
    expect(source.match(/process\.env/g)?.length ?? 0).toBe(2);
    expect(source).toContain('resolveDeploymentEnvironment');
  });
});
