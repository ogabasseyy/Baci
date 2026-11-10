import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MerchantContext } from '@/lib/get-merchant-for-api-request';
import { type OxygenOrderRow, resolveOxygenOrderContext } from './context';

const mocks = vi.hoisted(() => ({
  getMerchantForApiRequest: vi.fn(),
}));

type MerchantApiModule = typeof import('@/lib/get-merchant-for-api-request');

vi.mock('@/lib/get-merchant-for-api-request', async (importOriginal) => ({
  ...(await importOriginal<MerchantApiModule>()),
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
});
