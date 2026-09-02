import { describe, expect, it, vi } from 'vitest';
import { getJumiaOrderScope } from '../../get-jumia-order-scope';
import { getCachedJumiaOrderItems } from './get-cached-jumia-order-items';

vi.mock('../../get-jumia-order-scope', () => ({
  getJumiaOrderScope: vi.fn().mockResolvedValue({
    kind: 'ok',
    cachedMarketplaceKeys: ['NG-main', 'default'],
    marketplaceKey: 'NG-main',
    shopId: 'shop-1',
  }),
}));

function createSupabase(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockReturnValue(query);
  return { from: vi.fn(() => query), query };
}

describe('getCachedJumiaOrderItems', () => {
  it('returns scoped cached items without constructing a provider client', async () => {
    const { from, query } = createSupabase({
      data: {
        jumia_order_id: 'order-1',
        jumia_order_number: 'J-1',
        items: [{ id: 'item-1' }],
      },
      error: null,
    });

    await expect(
      getCachedJumiaOrderItems({
        supabase: { from } as never,
        merchantId: 'merchant-1',
        integrationId: 'integration-1',
        orderId: 'order-1',
      })
    ).resolves.toEqual({
      kind: 'ok',
      orderId: 'order-1',
      orderNumber: 'J-1',
      items: [{ id: 'item-1' }],
    });
    expect(query.eq).toHaveBeenCalledWith('jumia_shop_id', 'shop-1');
    expect(query.in).toHaveBeenCalledWith('marketplace_key', [
      'NG-main',
      'default',
    ]);
  });

  it('does not include neutral rows for a multi-marketplace shop', async () => {
    vi.mocked(getJumiaOrderScope).mockResolvedValueOnce({
      kind: 'ok',
      cachedMarketplaceKeys: ['NG-main'],
      marketplaceKey: 'NG-main',
      shopId: 'shop-1',
    });
    const { from, query } = createSupabase({
      data: {
        jumia_order_id: 'order-1',
        jumia_order_number: 'J-1',
        items: [{ id: 'item-1' }],
      },
      error: null,
    });

    await getCachedJumiaOrderItems({
      supabase: { from } as never,
      merchantId: 'merchant-1',
      integrationId: 'integration-1',
      orderId: 'order-1',
    });

    expect(query.in).toHaveBeenCalledWith('marketplace_key', ['NG-main']);
  });

  it('does not fabricate items when the cache query fails or has no array', async () => {
    const failing = createSupabase({
      data: null,
      error: { message: 'offline' },
    });
    await expect(
      getCachedJumiaOrderItems({
        supabase: { from: failing.from } as never,
        merchantId: 'merchant-1',
        integrationId: 'integration-1',
        orderId: 'order-1',
      })
    ).resolves.toEqual({ kind: 'database_error', message: 'offline' });

    const empty = createSupabase({
      data: {
        jumia_order_id: 'order-1',
        jumia_order_number: null,
        items: null,
      },
      error: null,
    });
    await expect(
      getCachedJumiaOrderItems({
        supabase: { from: empty.from } as never,
        merchantId: 'merchant-1',
        integrationId: 'integration-1',
        orderId: 'order-1',
      })
    ).resolves.toEqual({ kind: 'missing' });
  });
});
