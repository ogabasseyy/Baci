import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

const mockLookup = vi.fn().mockResolvedValue({ slugs: [], incomplete: false });

vi.mock('@/lib/get-published-blog-post-slugs-for-products', () => ({
  getPublishedBlogPostSlugsForProducts: (...args: unknown[]) =>
    mockLookup(...args),
}));

import { enrichProductPurgeEntries } from './authoritative-product-purge-enrichment';

describe('enrichProductPurgeEntries blog slug lookup failure', () => {
  it('fails open with empty article slugs when the lookup throws', async () => {
    mockLookup.mockRejectedValueOnce(new Error('lookup unavailable'));
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      const result = await enrichProductPurgeEntries(
        {} as unknown as SupabaseClient,
        'merchant-1',
        [{ slug: 'buds-pro', category: 'Audio' }]
      );

      expect(result.entries).toEqual([
        { slug: 'buds-pro', categorySegment: 'audio' },
      ]);
      expect(result.blogPostSlugs).toEqual([]);
      expect(result.blogPostSlugsIncomplete).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('continuing without article purge'),
        expect.objectContaining({ merchantId: 'merchant-1' })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('flags partial article sets so callers escalate to the hostname fallback', async () => {
    mockLookup.mockResolvedValueOnce({
      slugs: ['known-guide'],
      incomplete: true,
    });
    try {
      const result = await enrichProductPurgeEntries(
        {} as unknown as SupabaseClient,
        'merchant-1',
        [{ slug: 'buds-pro', category: 'Audio' }]
      );

      expect(result.blogPostSlugs).toEqual(['known-guide']);
      expect(result.blogPostSlugsIncomplete).toBe(true);
    } finally {
      mockLookup.mockReset();
      mockLookup.mockResolvedValue({ slugs: [], incomplete: false });
    }
  });

  it('flags incomplete when the product-row lookup resolves with an error', async () => {
    // The article lookup itself reports complete: only the upstream
    // resolution failure may set the flag.
    mockLookup.mockResolvedValueOnce({ slugs: [], incomplete: false });
    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            in: () =>
              Promise.resolve(
                table === 'products'
                  ? { data: null, error: { message: 'rows unavailable' } }
                  : { data: [], error: null }
              ),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const result = await enrichProductPurgeEntries(supabase, 'merchant-1', [
        { id: 'prod-1' },
      ]);

      expect(result.blogPostSlugsIncomplete).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('flags incomplete when the previous-category lookup resolves with an error', async () => {
    mockLookup.mockResolvedValueOnce({ slugs: [], incomplete: false });
    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            in: () =>
              Promise.resolve(
                table === 'categories'
                  ? { data: null, error: { message: 'rows unavailable' } }
                  : { data: [], error: null }
              ),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const result = await enrichProductPurgeEntries(supabase, 'merchant-1', [
        { id: 'prod-1', slug: 'buds-pro', previousCategoryId: 'cat-old' },
      ]);

      expect(result.blogPostSlugsIncomplete).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
