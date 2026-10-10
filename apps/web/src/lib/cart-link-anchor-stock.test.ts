import { expect, it, vi } from 'vitest';
import { fetchCartLinkAnchorStock } from './cart-link-anchor-stock';

const simple = '55555555-5555-4555-8555-555555555555';
const variant = '66666666-6666-4666-8666-666666666666';

function setupRpc(anchors: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => anchors);
  return { rpc, supabase: { rpc } };
}

it('delegates simple product ids while excluding variant parents', async () => {
  const { rpc, supabase } = setupRpc({ data: [], error: null });

  const result = await fetchCartLinkAnchorStock({
    supabase: supabase as never,
    merchantId: 'merchant-1',
    products: [
      { id: simple, has_variants: false },
      { id: variant, has_variants: true },
    ],
  });

  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith(
    'get_mcp_search_serialized_anchor_policies',
    { p_product_ids: [simple], p_merchant_id: 'merchant-1' }
  );
  expect(result.failed).toBe(false);
});

it('skips the lookup when no simple products are present', async () => {
  const { rpc, supabase } = setupRpc({ data: [], error: null });

  const result = await fetchCartLinkAnchorStock({
    supabase: supabase as never,
    merchantId: 'merchant-1',
    products: [{ id: variant, has_variants: true }],
  });

  expect(rpc).not.toHaveBeenCalled();
  expect(result).toEqual({ projections: new Map(), failed: false });
});

it('projects a strict anchor onto its product id', async () => {
  const { supabase } = setupRpc({
    data: [
      {
        product_id: simple,
        effective_policy: 'serialized_strict',
        available_units: 2,
      },
    ],
    error: null,
  });

  const result = await fetchCartLinkAnchorStock({
    supabase: supabase as never,
    merchantId: 'merchant-1',
    products: [{ id: simple, has_variants: null }],
  });

  expect(result.failed).toBe(false);
  expect(result.projections.get(simple)).toEqual({
    manageStock: true,
    stockQuantity: 2,
  });
});

it('logs and reports failure when the anchor lookup fails', async () => {
  const errorSpy = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  try {
    const { supabase } = setupRpc({
      data: null,
      error: { message: 'down' },
    });

    const result = await fetchCartLinkAnchorStock({
      supabase: supabase as never,
      merchantId: 'merchant-1',
      products: [{ id: simple }],
    });

    expect(result.failed).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to fetch serialized anchor policy for cart transfer:',
      { message: 'down' }
    );
  } finally {
    errorSpy.mockRestore();
  }
});
