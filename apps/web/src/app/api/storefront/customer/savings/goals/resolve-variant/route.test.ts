import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  context: vi.fn(),
  settings: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/customer-savings-nonpayment-context', () => ({
  resolveCustomerSavingsNonpaymentContext: mocks.context,
}));
vi.mock('@/lib/customer-savings-nonpayment-settings', () => ({
  getCustomerSavingsNonpaymentSettings: mocks.settings,
}));

import { POST } from './route';

const input = {
  goalId: '00000000-0000-4000-8000-000000000001',
  variantId: '00000000-0000-4000-8000-000000000002',
  merchantSlug: 'ogabassey',
};
const request = (body: unknown = input) =>
  new NextRequest(
    'http://localhost/api/storefront/customer/savings/goals/resolve-variant',
    { method: 'POST', body: JSON.stringify(body) }
  );

const publicVariant = {
  id: input.variantId,
  is_active: true,
  status: 'active',
  deleted_at: null,
  archived_at: null,
  is_inventory_anchor: false,
};

function queryFor(result: { data: unknown; error: unknown }) {
  const query = {
    eq: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue(result),
    select: vi.fn(() => query),
  };
  return query;
}

const RECOVERY_RPC = 'resolve_completed_customer_savings_goal_variant';
const VARIANTS_RPC = 'get_storefront_product_variants';

let variantRows: unknown = [{ ...publicVariant, product_id: 'product-1' }];
let recoveryResult: { data: unknown; error: unknown } = {
  data: [{ success: true, goal_id: input.goalId, goal_status: 'completed' }],
  error: null,
};

function mockRpcRouter() {
  mocks.rpc.mockImplementation((fn: string) => {
    if (fn === VARIANTS_RPC) {
      return Promise.resolve({ data: variantRows, error: null });
    }
    return Promise.resolve(recoveryResult);
  });
}

function recoveryCalls() {
  return mocks.rpc.mock.calls.filter(([fn]) => fn === RECOVERY_RPC);
}

function mockVisibilityTables({
  goal = { data: { id: input.goalId, product_id: 'product-1' }, error: null },
  product = {
    data: {
      id: 'product-1',
      name: 'Device',
      price: 100,
      images: [],
      condition: 'new',
    },
    error: null,
  },
  variants = [{ ...publicVariant, product_id: 'product-1' }],
}: {
  goal?: { data: unknown; error: unknown };
  product?: { data: unknown; error: unknown };
  variants?: unknown;
} = {}) {
  mocks.from.mockImplementation((table: string) => {
    if (table === 'customer_savings_goals') return queryFor(goal);
    if (table === 'products') return queryFor(product);
    throw new Error(`Unexpected table: ${table}`);
  });
  variantRows = variants;
}

describe('completed savings variant recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: { id: 'actor' },
      supabase: {},
      error: null,
    });
    mocks.csrf.mockResolvedValue({ valid: true });
    mocks.context.mockResolvedValue({
      customer: { id: 'trusted-customer' },
      merchant: { id: 'trusted-merchant' },
      supabase: { rpc: mocks.rpc, from: mocks.from },
    });
    mocks.settings.mockResolvedValue({ savingsEnabled: true });
    mockVisibilityTables();
    recoveryResult = {
      data: [
        { success: true, goal_id: input.goalId, goal_status: 'completed' },
      ],
      error: null,
    };
    mockRpcRouter();
  });

  it('rejects unauthenticated requests before context resolution', async () => {
    mocks.auth.mockResolvedValue({
      user: null,
      supabase: null,
      error: 'Unauthorized',
    });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.csrf).not.toHaveBeenCalled();
  });

  it('rejects CSRF failure without calling the RPC', async () => {
    mocks.csrf.mockResolvedValue({ valid: false });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects client balance overrides before database access', async () => {
    expect(
      (await POST(request({ ...input, currentAmount: 999999 }))).status
    ).toBe(400);
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it('rejects disabled savings', async () => {
    mocks.settings.mockResolvedValue({ savingsEnabled: false });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('fails closed when settings storage fails without invoking variant recovery', async () => {
    mocks.settings.mockRejectedValue(new Error('private database failure'));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Unable to confirm this savings variant',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before resolving a customer', async () => {
    const malformed = new NextRequest('http://localhost/api/savings', {
      method: 'POST',
      body: '{',
    });
    expect((await POST(malformed)).status).toBe(400);
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it('preserves tenant-resolution denial without calling the RPC', async () => {
    mocks.context.mockResolvedValue({
      response: new Response(null, { status: 403 }),
    });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a successful row for a different goal', async () => {
    recoveryResult = {
      data: [
        { success: true, goal_id: 'other-goal', goal_status: 'completed' },
      ],
      error: null,
    };
    expect((await POST(request())).status).toBe(500);
  });

  it('uses authenticated server-resolved ownership and no client price', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      goalId: input.goalId,
      goalStatus: 'completed',
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'resolve_completed_customer_savings_goal_variant',
      {
        p_actor_id: 'actor',
        p_customer_id: 'trusted-customer',
        p_merchant_id: 'trusted-merchant',
        p_goal_id: input.goalId,
        p_variant_id: input.variantId,
      }
    );
  });

  it('returns conflict for a goal that cannot be recovered', async () => {
    recoveryResult = {
      data: null,
      error: {
        message: 'savings_goal_not_legacy_variant_recoverable',
        code: 'P0001',
      },
    };
    expect((await POST(request())).status).toBe(409);
  });

  it('redacts unexpected RPC failures', async () => {
    mocks.rpc.mockRejectedValue(new Error('sensitive provider material'));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('sensitive');
  });

  it('rejects malformed success data', async () => {
    recoveryResult = { data: [{ success: false }], error: null };
    expect((await POST(request())).status).toBe(500);
  });

  it('rejects a retained UUID for an archived variant without recovering', async () => {
    mockVisibilityTables({
      variants: [
        {
          ...publicVariant,
          product_id: 'product-1',
          archived_at: '2026-09-01T00:00:00Z',
        },
      ],
    });
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: 'SAVINGS_DEVICE_VARIANT_NOT_FOUND',
      error: 'Savings device variant is not available',
    });
    expect(recoveryCalls()).toHaveLength(0);
  });

  it('rejects a variant that left the product without recovering', async () => {
    mockVisibilityTables({ variants: [] });
    expect((await POST(request())).status).toBe(404);
    expect(recoveryCalls()).toHaveLength(0);
  });

  it('defers to the RPC when the goal row is absent', async () => {
    mockVisibilityTables({ goal: { data: null, error: null } });
    recoveryResult = {
      data: null,
      error: {
        message: 'savings_goal_not_legacy_variant_recoverable',
        code: 'P0001',
      },
    };
    expect((await POST(request())).status).toBe(409);
    expect(recoveryCalls()).toHaveLength(1);
  });
});
