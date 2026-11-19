import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { enrichProductPurgeEntries } from './authoritative-product-purge-enrichment';

interface TableResult {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}

/**
 * Minimal Supabase stub matching the enrichment's
 * `.from(table).select(...).eq('merchant_id', …).in('id', …)` chain, returning a
 * per-table configured result.
 */
function makeSupabase(results: {
  products?: TableResult;
  categories?: TableResult;
}): { supabase: SupabaseClient; inSpy: ReturnType<typeof vi.fn> } {
  const inSpy = vi.fn();
  const supabase = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          in: (_column: string, ids: string[]) => {
            inSpy(table, ids);
            const result =
              table === 'categories'
                ? (results.categories ?? { data: [], error: null })
                : (results.products ?? { data: [], error: null });
            return Promise.resolve(result);
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  return { supabase, inSpy };
}

const MERCHANT_ID = 'merchant-1';

describe('enrichProductPurgeEntries', () => {
  it('resolves the authoritative slug + category for an id-only entry', async () => {
    const { supabase } = makeSupabase({
      products: {
        data: [
          {
            id: 'prod-1',
            slug: 'iphone-15',
            name: 'iPhone 15',
            category: 'Smartphones',
            categories: null,
            product_categories: [],
          },
        ],
        error: null,
      },
    });

    const { entries, resolvedSlugs, authoritativeSlugsById } =
      await enrichProductPurgeEntries(supabase, MERCHANT_ID, [
        { id: 'prod-1' },
      ]);

    expect(entries).toEqual([
      { slug: 'iphone-15', categorySegment: 'smartphones' },
    ]);
    // Authoritative slug + id are both busted (rename-safe).
    expect(resolvedSlugs).toEqual(['iphone-15', 'prod-1']);
    expect(authoritativeSlugsById?.get('prod-1')).toBe('iphone-15');
  });

  it('appends an old-category purge when previousCategoryId resolves to a different slug', async () => {
    const { supabase } = makeSupabase({
      products: {
        data: [
          {
            id: 'prod-1',
            slug: 'iphone-15',
            name: 'iPhone 15',
            category: 'Smartphones',
            categories: null,
            product_categories: [],
          },
        ],
        error: null,
      },
      categories: { data: [{ id: 'cat-old', slug: 'phones' }], error: null },
    });

    const { entries } = await enrichProductPurgeEntries(supabase, MERCHANT_ID, [
      { id: 'prod-1', previousCategoryId: 'cat-old' },
    ]);

    expect(entries).toEqual([
      { slug: 'iphone-15', categorySegment: 'smartphones' },
      { slug: 'iphone-15', categorySegment: 'phones' },
    ]);
  });

  it('skips the DB lookups and uses caller hints when no ids are supplied', async () => {
    const { supabase, inSpy } = makeSupabase({});

    const { entries, resolvedSlugs } = await enrichProductPurgeEntries(
      supabase,
      MERCHANT_ID,
      [{ slug: 'buds-pro', category: 'Audio' }]
    );

    expect(inSpy).not.toHaveBeenCalled();
    expect(entries).toEqual([{ slug: 'buds-pro', categorySegment: 'audio' }]);
    expect(resolvedSlugs).toEqual(['buds-pro']);
  });

  it('fails open to caller hints and logs when the product-row lookup errors', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const { supabase } = makeSupabase({
        products: { data: null, error: { message: 'db unavailable' } },
      });

      const { entries } = await enrichProductPurgeEntries(
        supabase,
        MERCHANT_ID,
        [{ slug: 'buds-pro', id: 'prod-1', category: 'Audio' }]
      );

      expect(entries).toEqual([{ slug: 'buds-pro', categorySegment: 'audio' }]);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve authoritative product rows'),
        expect.objectContaining({ merchantId: MERCHANT_ID })
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
