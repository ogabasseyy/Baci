import { describe, expect, it, vi } from 'vitest';
import { getJumiaShopNonDefaultMarketplaceKeys } from './shop-marketplace-scope';

function supabaseWithKeys(
  rows: Array<{ marketplace_key: string | null }>,
  error: { message: string } | null = null
) {
  const result = Promise.resolve({ data: rows, error });
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn(() => query),
    or: vi.fn(() => result),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query mocks are intentionally thenable.
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
      result.then(resolve),
  };
  return { from: vi.fn(() => query), query };
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
    const { from } = supabaseWithKeys([], { message: 'db down' });

    const keys = await getJumiaShopNonDefaultMarketplaceKeys(
      { from } as never,
      'merchant-1',
      'shop-1'
    );

    expect(keys).toEqual({ kind: 'database_error', message: 'db down' });
  });

  it('counts keys within the selected country when provided', async () => {
    const { from, query } = supabaseWithKeys([{ marketplace_key: 'NG-main' }]);

    const keys = await getJumiaShopNonDefaultMarketplaceKeys(
      { from } as never,
      'merchant-1',
      'shop-1',
      { countryCode: 'ng' }
    );

    expect(query.or).toHaveBeenCalledWith(
      'country_code.eq.NG,country_code.is.null'
    );
    expect(keys).toEqual(new Set(['NG-main']));
  });

  it('keeps the shop-wide count without a valid country code', async () => {
    const { from, query } = supabaseWithKeys([{ marketplace_key: 'NG-main' }]);

    await getJumiaShopNonDefaultMarketplaceKeys(
      { from } as never,
      'merchant-1',
      'shop-1',
      { countryCode: 'NG;DROP' }
    );

    expect(query.or).not.toHaveBeenCalled();
  });
});
