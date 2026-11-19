import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveDependentAliases = vi.fn();

vi.mock('@/lib/resolve-dependent-legacy-product-identifiers', () => ({
  resolveDependentLegacyProductIdentifiers: (...args: unknown[]) =>
    mockResolveDependentAliases(...args),
}));

import { mergeDependentAliasTargets } from './merge-dependent-alias-targets';

describe('mergeDependentAliasTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveDependentAliases.mockResolvedValue({
      identifiers: ['archived-child', 'child-uuid'],
      incomplete: false,
    });
  });

  it('merges parent ids and dependent legacy child identifiers into Next slugs and edge entries', async () => {
    const supabase = {} as SupabaseClient;
    const result = await mergeDependentAliasTargets({
      supabase,
      merchantId: 'merchant-1',
      products: [
        { id: 'parent-1', slug: 'iphone-15', previousSlug: 'iphone-15' },
      ],
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      slugs: ['iphone-15', 'parent-1'],
    });

    expect(mockResolveDependentAliases).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      ['parent-1']
    );
    expect(result).toEqual({
      entries: [
        { slug: 'iphone-15', categorySegment: 'smartphones' },
        { slug: 'parent-1', categorySegment: null },
        { slug: 'archived-child', categorySegment: null },
        { slug: 'child-uuid', categorySegment: null },
      ],
      slugs: ['iphone-15', 'parent-1', 'archived-child', 'child-uuid'],
      incomplete: false,
    });
  });

  it('adds the parent id edge entry even when no dependent aliases exist', async () => {
    mockResolveDependentAliases.mockResolvedValueOnce({
      identifiers: [],
      incomplete: false,
    });
    const result = await mergeDependentAliasTargets({
      supabase: {} as SupabaseClient,
      merchantId: 'merchant-1',
      products: [{ id: 'parent-1', slug: 'iphone-15' }],
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      slugs: ['iphone-15'],
    });

    expect(result.entries).toEqual([
      { slug: 'iphone-15', categorySegment: 'smartphones' },
      { slug: 'parent-1', categorySegment: null },
    ]);
    expect(result.slugs).toEqual(['iphone-15', 'parent-1']);
  });

  it('skips alias queries when no product ids are supplied and preserves incomplete flags', async () => {
    const supabase = {} as SupabaseClient;
    const noIdResult = await mergeDependentAliasTargets({
      supabase,
      merchantId: 'merchant-1',
      products: [{ slug: 'iphone-15' }],
      entries: [{ slug: 'iphone-15', categorySegment: null }],
      slugs: ['iphone-15'],
    });

    expect(mockResolveDependentAliases).not.toHaveBeenCalled();
    expect(noIdResult.incomplete).toBe(false);

    mockResolveDependentAliases.mockResolvedValueOnce({
      identifiers: ['archived-child'],
      incomplete: true,
    });
    const incompleteResult = await mergeDependentAliasTargets({
      supabase,
      merchantId: 'merchant-1',
      products: [{ id: 'parent-1' }],
      entries: [{ slug: 'iphone-15', categorySegment: null }],
      slugs: ['iphone-15'],
    });

    expect(incompleteResult.incomplete).toBe(true);
  });
});
