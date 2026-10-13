import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { createAnonClient } from '@/lib/supabase/anon';
import { POST } from './route';

const mockCreateAnonClient = vi.mocked(createAnonClient);

let merchantRow: unknown = null;

function mockRpc(
  impl: (fn: string, args: Record<string, unknown>) => unknown,
  errors: { merchant?: unknown; rpc?: Record<string, unknown> } = {}
) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => ({
    data: errors.rpc?.[fn] ? null : impl(fn, args),
    error: errors.rpc?.[fn] ?? null,
  }));
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({
          data: errors.merchant ? null : merchantRow,
          error: errors.merchant ?? null,
        })),
      })),
    })),
  }));
  mockCreateAnonClient.mockReturnValue({ rpc, from } as never);
  return rpc;
}

function request(body: unknown): NextRequest {
  return new Request('http://localhost/api/storefront/discount/validate', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as NextRequest;
}

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

const baseBody = {
  merchant_id: MERCHANT_ID,
  code: 'RDM-ABCDEF12',
  cart_total: 10000,
};

function loyaltyRow(overrides: Record<string, unknown> = {}) {
  return {
    redemption_id: '22222222-2222-4222-8222-222222222222',
    reward_type: 'discount_fixed',
    reward_value: 1000,
    minimum_order_amount: null,
    expires_at: null,
    used: false,
    issuance_currency: 'NGN',
    max_redemption_percentage: null,
    reward_name: 'Probe reward',
    ...overrides,
  };
}

describe('POST /api/storefront/discount/validate loyalty fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    merchantRow = null;
  });

  it('returns the merchant code without calling the loyalty resolve', async () => {
    const rpc = mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? [
            {
              id: '33333333-3333-4333-8333-333333333333',
              code: 'SAVE10',
              discount_type: 'percentage',
              discount_value: 10,
              starts_at: null,
              expires_at: null,
              usage_limit: null,
              usage_count: 0,
              minimum_purchase_amount: null,
              maximum_discount_amount: null,
              description: null,
              applies_to: 'all',
              product_ids: [],
              category_ids: [],
              usage_limit_per_customer: null,
            },
          ]
        : []
    );

    const response = await POST(request({ ...baseBody, code: 'SAVE10' }));
    const body = await response.json();

    expect(body.valid).toBe(true);
    expect(body.discount_code_id).toBe('33333333-3333-4333-8333-333333333333');
    expect(
      rpc.mock.calls.some(
        ([fn]) => fn === 'get_loyalty_redemption_for_checkout'
      )
    ).toBe(false);
  });

  it('validates a bridgeable loyalty code after a merchant miss', async () => {
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code' ? [] : [loyaltyRow()]
    );

    const response = await POST(request(baseBody));
    const body = await response.json();

    expect(body).toMatchObject({
      valid: true,
      code: 'RDM-ABCDEF12',
      discount_type: 'fixed',
      discount_value: 1000,
      discount_amount: 1000,
      description: 'Probe reward',
    });
    expect(body.discount_code_id).toBeNull();
    // The internal redemption UUID stays server-side: the order route
    // re-resolves the public code, so anon callers get no row handle.
    expect(body.loyalty_redemption_id).toBeUndefined();
  });

  it('returns 500 when the merchant lookup fails instead of invalid', async () => {
    mockRpc(() => [], {
      rpc: { get_storefront_discount_code: new Error('boom') },
    });

    const response = await POST(request(baseBody));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      valid: false,
      error: 'Internal server error',
    });
  });

  it('returns invalid when neither lookup resolves', async () => {
    mockRpc(() => []);

    const response = await POST(request(baseBody));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ valid: false, error: 'Invalid discount code' });
  });

  it('collapses an already-used loyalty code to generic invalid', async () => {
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code' ? [] : [loyaltyRow({ used: true })]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body).toEqual({ valid: false, error: 'Invalid discount code' });
  });

  it('rejects a non-discount loyalty type as invalid', async () => {
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [loyaltyRow({ reward_type: 'free_shipping', reward_value: null })]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body).toEqual({ valid: false, error: 'Invalid discount code' });
  });

  it('enforces the loyalty minimum against the cart total', async () => {
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [loyaltyRow({ minimum_order_amount: 50000 })]
    );

    const body = await (
      await POST(request({ ...baseBody, cart_total: 10000 }))
    ).json();

    expect(body.valid).toBe(false);
    expect(body.error).toContain('Minimum purchase of');
  });

  it('collapses an expired loyalty code to generic invalid', async () => {
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [loyaltyRow({ expires_at: '2020-01-01T00:00:00.000Z' })]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body).toEqual({ valid: false, error: 'Invalid discount code' });
  });

  it('returns 500 when the loyalty lookup errors', async () => {
    const rpc = vi.fn(async (fn: string) =>
      fn === 'get_storefront_discount_code'
        ? { data: [], error: null }
        : { data: null, error: { message: 'boom' } }
    );
    mockCreateAnonClient.mockReturnValue({ rpc } as never);

    const response = await POST(request(baseBody));
    const body = await response.json();

    // A failed lookup is a retryable 500, not an invalid code: holders
    // must not be told an issued code is invalid during an outage.
    expect(response.status).toBe(500);
    expect(body).toEqual({ valid: false, error: 'Internal server error' });
  });

  it('validates a code whose reward was later disabled', async () => {
    // Snapshot-governed: the resolver selects no live reward state, so
    // validate cannot see a later disable and the paid code validates.
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code' ? [] : [loyaltyRow()]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body).toMatchObject({ valid: true, code: 'RDM-ABCDEF12' });
  });

  it('bridges a plain discount code with fixed semantics', async () => {
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [loyaltyRow({ reward_type: 'discount', reward_value: 1500 })]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body).toMatchObject({
      valid: true,
      discount_type: 'fixed',
      discount_value: 1500,
      discount_amount: 1500,
    });
  });

  it('formats the loyalty minimum in the merchant currency', async () => {
    merchantRow = { country: 'US', payout_currency: 'USD' };
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [loyaltyRow({ minimum_order_amount: 50000 })]
    );

    const body = await (
      await POST(request({ ...baseBody, cart_total: 10000 }))
    ).json();

    expect(body.valid).toBe(false);
    expect(body.error).toContain('Minimum purchase of');
    expect(body.error).toContain('$');
    expect(body.error).not.toContain('₦');
  });

  it('keeps the minimum label currency-neutral on lookup failure', async () => {
    mockRpc(
      (fn) =>
        fn === 'get_storefront_discount_code'
          ? []
          : [loyaltyRow({ minimum_order_amount: 50000 })],
      { merchant: { message: 'db down' } }
    );

    const body = await (
      await POST(request({ ...baseBody, cart_total: 10000 }))
    ).json();

    expect(body.valid).toBe(false);
    expect(body.error).toBe('Minimum purchase of 50,000 required');
    expect(body.error).not.toMatch(/₦|₹|\$/);
  });

  it('caps the preview discount at the snapshotted max redemption percentage', async () => {
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [loyaltyRow({ reward_value: 5000, max_redemption_percentage: 25 })]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body.valid).toBe(true);
    expect(body.discount_amount).toBe(2500);
  });

  it('collapses a minimum-carrying percentage code after a currency change', async () => {
    merchantRow = { country: 'US', payout_currency: 'USD' };
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [
            loyaltyRow({
              reward_type: 'discount_percentage',
              reward_value: 10,
              minimum_order_amount: 5000,
            }),
          ]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body).toEqual({ valid: false, error: 'Invalid discount code' });
  });

  it('collapses a fixed code to invalid after a merchant currency change', async () => {
    merchantRow = { country: 'US', payout_currency: 'USD' };
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code' ? [] : [loyaltyRow()]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body).toEqual({ valid: false, error: 'Invalid discount code' });
  });

  it('rejects invalid input before any lookup', async () => {
    const rpc = mockRpc(() => []);

    const response = await POST(request({ code: 'x' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.valid).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
