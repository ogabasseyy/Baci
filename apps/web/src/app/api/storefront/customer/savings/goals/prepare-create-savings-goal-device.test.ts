import { describe, expect, it, vi } from 'vitest';
import { prepareCreateSavingsGoalDevice } from './prepare-create-savings-goal-device';

function createProductQuery(result: {
  data: Record<string, unknown> | null;
  error: null | Record<string, unknown>;
}) {
  const query = {
    eq: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue(result),
    select: vi.fn(() => query),
  };
  return query;
}

function createVariantsRpc(variantRows: unknown) {
  return vi.fn((fn: string) => {
    expect(fn).toBe('get_storefront_product_variants');
    return Promise.resolve({ data: variantRows, error: null });
  });
}

describe('prepareCreateSavingsGoalDevice', () => {
  it('returns 404 when the merchant product cannot be loaded', async () => {
    const query = createProductQuery({ data: null, error: null });
    const result = await prepareCreateSavingsGoalDevice({
      merchantId: 'merchant-1',
      productId: '00000000-0000-4000-8000-000000000101',
      supabase: { from: vi.fn(() => query), rpc: createVariantsRpc([]) },
      targetAmount: 800000,
      variantId: null,
    });

    expect('response' in result).toBe(true);
    if (!('response' in result)) {
      return;
    }
    expect(result.response.status).toBe(404);
  });

  it('returns the exact variant snapshot for a matching selection', async () => {
    const query = createProductQuery({
      data: {
        condition: 'used',
        id: '00000000-0000-4000-8000-000000000101',
        images: [],
        name: 'iPhone 15 Pro',
        price: '700000',
      },
      error: null,
    });
    const rpc = createVariantsRpc([
      {
        attributes: { storage: '256GB' },
        id: '00000000-0000-4000-8000-000000000102',
        price_override: '850000',
        product_id: '00000000-0000-4000-8000-000000000101',
      },
    ]);

    const result = await prepareCreateSavingsGoalDevice({
      merchantId: 'merchant-1',
      productId: '00000000-0000-4000-8000-000000000101',
      supabase: { from: vi.fn(() => query), rpc },
      targetAmount: 850000,
      variantId: '00000000-0000-4000-8000-000000000102',
    });

    expect(result).toMatchObject({
      device: {
        targetAmount: 850000,
        variantId: '00000000-0000-4000-8000-000000000102',
      },
    });
    expect(rpc).toHaveBeenCalledWith('get_storefront_product_variants', {
      p_product_ids: ['00000000-0000-4000-8000-000000000101'],
    });
  });
});
