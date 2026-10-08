import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { SERIALIZED_THEN_UNLIMITED_STOCK_QUANTITY } from './hydrate-public-products';
import { resolveSerializedAnchorStock } from './serialized-anchor-stock';

const STRICT = '11111111-1111-4111-8111-111111111111';
const UNLIMITED = '22222222-2222-4222-8222-222222222222';
const PLAIN = '33333333-3333-4333-8333-333333333333';

function clientWithAnchors(
  rows: Record<string, unknown>[] | null,
  error: unknown = null
): Pick<SupabaseClient, 'rpc'> {
  return {
    rpc: vi.fn(async () => ({ data: rows, error })),
  } as unknown as Pick<SupabaseClient, 'rpc'>;
}

it('projects strict anchors to managed units and unlimited anchors to the sentinel', async () => {
  const supabase = clientWithAnchors([
    {
      product_id: STRICT,
      effective_policy: 'serialized_strict',
      available_units: 3,
    },
    {
      product_id: UNLIMITED,
      effective_policy: 'serialized_then_unlimited',
      available_units: 0,
    },
  ]);

  const result = await resolveSerializedAnchorStock({
    supabase,
    merchantId: 'merchant-1',
    productIds: [STRICT, UNLIMITED, PLAIN],
  });

  expect(result.failed).toBe(false);
  expect(result.projections.get(STRICT)).toEqual({
    manageStock: true,
    stockQuantity: 3,
  });
  expect(result.projections.get(UNLIMITED)).toEqual({
    manageStock: false,
    stockQuantity: SERIALIZED_THEN_UNLIMITED_STOCK_QUANTITY,
  });
  expect(result.projections.has(PLAIN)).toBe(false);
  expect(supabase.rpc).toHaveBeenCalledWith(
    'get_mcp_search_serialized_anchor_policies',
    { p_product_ids: [STRICT, UNLIMITED, PLAIN], p_merchant_id: 'merchant-1' }
  );
});

it('keeps nonzero unlimited units instead of the sentinel', async () => {
  const supabase = clientWithAnchors([
    {
      product_id: UNLIMITED,
      effective_policy: 'serialized_then_unlimited',
      available_units: 5,
    },
  ]);

  const result = await resolveSerializedAnchorStock({
    supabase,
    merchantId: 'merchant-1',
    productIds: [UNLIMITED],
  });

  expect(result.failed).toBe(false);
  expect(result.projections.get(UNLIMITED)).toEqual({
    manageStock: false,
    stockQuantity: 5,
  });
});

it('ignores unrecognized policies and null units', async () => {
  const supabase = clientWithAnchors([
    {
      product_id: STRICT,
      effective_policy: 'off',
      available_units: 3,
    },
    {
      product_id: UNLIMITED,
      effective_policy: 'serialized_strict',
      available_units: null,
    },
  ]);

  const result = await resolveSerializedAnchorStock({
    supabase,
    merchantId: 'merchant-1',
    productIds: [STRICT, UNLIMITED],
  });

  expect(result.failed).toBe(false);
  expect(result.projections.has(STRICT)).toBe(false);
  expect(result.projections.get(UNLIMITED)).toEqual({
    manageStock: true,
    stockQuantity: 0,
  });
});

it('reports failure without projections when the RPC errors', async () => {
  const supabase = clientWithAnchors(null, { message: 'down' });

  const result = await resolveSerializedAnchorStock({
    supabase,
    merchantId: 'merchant-1',
    productIds: [STRICT],
  });

  expect(result.failed).toBe(true);
  expect(result.error).toEqual({ message: 'down' });
  expect(result.projections.size).toBe(0);
});

it('skips the RPC when no products need projection', async () => {
  const supabase = clientWithAnchors([]);

  const result = await resolveSerializedAnchorStock({
    supabase,
    merchantId: 'merchant-1',
    productIds: [],
  });

  expect(result).toEqual({ projections: new Map(), failed: false });
  expect(supabase.rpc).not.toHaveBeenCalled();
});
