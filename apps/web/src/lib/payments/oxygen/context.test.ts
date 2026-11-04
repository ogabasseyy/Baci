import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
