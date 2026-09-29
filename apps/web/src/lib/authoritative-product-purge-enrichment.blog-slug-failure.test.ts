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
});
