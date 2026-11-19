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

describe('resolveOxygenOrderContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMerchantForApiRequest.mockResolvedValue(null);
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
