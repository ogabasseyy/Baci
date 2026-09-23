import { describe, expect, it, vi } from 'vitest';
import { getJumiaShopNonDefaultMarketplaceKeys } from './shop-marketplace-scope';

function supabaseWithKeys(rows: Array<{ marketplace_key: string | null }>) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((column: string) =>
      column === 'shop_id'
        ? Promise.resolve({ data: rows, error: null })
        : query
    ),
  };
  return { from: vi.fn(() => query) };
}

describe('getJumiaShopNonDefaultMarketplaceKeys', () => {
  it('collects distinct trimmed non-default keys', async () => {
    const supabase = supabaseWithKeys([
      { marketplace_key: '  Jumia NG  ' },
      { marketplace_key: 'Jumia NG' },
      { marketplace_key: 'Jumia GH' },
      { marketplace_key: 'default' },
      { marketplace_key: null },
    ]);

    const keys = await getJumiaShopNonDefaultMarketplaceKeys(
      supabase as never,
      'merchant-1',
      'shop-1'
    );

    expect(keys).toEqual(new Set(['Jumia NG', 'Jumia GH']));
  });

  it('returns an empty set when no scoped integrations exist', async () => {
    const supabase = supabaseWithKeys([]);

    const keys = await getJumiaShopNonDefaultMarketplaceKeys(
      supabase as never,
      'merchant-1',
      'shop-1'
    );

    expect(keys).toEqual(new Set());
  });

  it('surfaces database errors to the caller', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((column: string) =>
        column === 'shop_id'
          ? Promise.resolve({ data: null, error: { message: 'db down' } })
          : query
      ),
    };
    const supabase = { from: vi.fn(() => query) };

    const keys = await getJumiaShopNonDefaultMarketplaceKeys(
      supabase as never,
      'merchant-1',
      'shop-1'
    );

    expect(keys).toEqual({ kind: 'database_error', message: 'db down' });
  });
});
