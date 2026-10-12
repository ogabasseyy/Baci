import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAliasMaybeSingle = vi.fn();
const mockMerchantMaybeSingle = vi.fn();

// The helper reads public routing data with an ANON client (never service-role
// — it is called from user-facing routes too).
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({
    from: (table: string) => {
      const resolver =
        table === 'merchant_slug_aliases'
          ? mockAliasMaybeSingle
          : mockMerchantMaybeSingle;
      const builder = {
        select: () => builder,
        eq: () => builder,
        limit: () => builder,
        maybeSingle: (...args: unknown[]) => resolver(...args),
      };
      return builder;
    },
  }),
}));

const {
  getCurrentSlugForAlias,
  getCurrentSlugForAliasStrict,
  invalidateAliasCacheForSlug,
} = await import('./slug-alias-cache');

describe('getCurrentSlugForAlias', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Default: no live merchant currently owns the queried slug.
    mockMerchantMaybeSingle.mockResolvedValue({ data: null, error: null });
  });

  it("resolves the merchant's current slug for a retired alias", async () => {
    mockAliasMaybeSingle.mockResolvedValue({
      data: { merchants: { slug: 'zorvexa' } },
      error: null,
    });
    expect(await getCurrentSlugForAlias('yodhashop')).toBe('zorvexa');
  });

  it('returns null when the slug is not a retired alias', async () => {
    mockAliasMaybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await getCurrentSlugForAlias('never-renamed')).toBeNull();
    // The liveness check must not run when the slug isn't even an alias.
    expect(mockMerchantMaybeSingle).not.toHaveBeenCalled();
  });

  it('does not redirect when a live merchant currently owns the slug', async () => {
    mockAliasMaybeSingle.mockResolvedValue({
      data: { merchants: { slug: 'someone-else' } },
      error: null,
    });
    mockMerchantMaybeSingle.mockResolvedValue({
      data: { id: 'live-merchant' },
      error: null,
    });
    expect(await getCurrentSlugForAlias('reclaimed-slug')).toBeNull();
  });

  it('returns null (fail-open) on an alias-lookup DB error', async () => {
    mockAliasMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    });
    expect(await getCurrentSlugForAlias('erroring-slug')).toBeNull();
  });

  it('does not redirect when the liveness check errors (fail-safe)', async () => {
    mockAliasMaybeSingle.mockResolvedValue({
      data: { merchants: { slug: 'safe-new' } },
      error: null,
    });
    // Can't confirm the old slug is free -> treat as live -> never 301 away.
    mockMerchantMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    });
    expect(await getCurrentSlugForAlias('safe-old')).toBeNull();
  });

  it('caches the alias mapping within the TTL so repeated lookups hit the DB once', async () => {
    mockAliasMaybeSingle.mockResolvedValue({
      data: { merchants: { slug: 'renamed' } },
      error: null,
    });
    await getCurrentSlugForAlias('cached-slug');
    await getCurrentSlugForAlias('cached-slug');
    expect(mockAliasMaybeSingle).toHaveBeenCalledTimes(1);
  });

  it('resolves a multi-rename chain (A->B->C) to the final current slug for every retired slug, without looping', async () => {
    // After A->B->C, both A and B are aliases whose merchant is currently 'c'.
    mockAliasMaybeSingle.mockResolvedValue({
      data: { merchants: { slug: 'c-final' } },
      error: null,
    });
    expect(await getCurrentSlugForAlias('a-first')).toBe('c-final');
    expect(await getCurrentSlugForAlias('b-mid')).toBe('c-final');
  });

  it('invalidateAliasCacheForSlug drops mapping entries whose CURRENT-slug value matches (repeat rename)', async () => {
    mockAliasMaybeSingle.mockResolvedValue({
      data: { merchants: { slug: 'y-slug' } },
      error: null,
    });
    // Cache inv-old -> y-slug.
    expect(await getCurrentSlugForAlias('inv-old')).toBe('y-slug');
    expect(mockAliasMaybeSingle).toHaveBeenCalledTimes(1);

    // A second rename retires 'y-slug'; invalidating it must also drop the older
    // inv-old -> y-slug mapping (its target is now stale).
    invalidateAliasCacheForSlug('y-slug');

    // Re-resolving inv-old now re-fetches (its cached mapping was cleared).
    await getCurrentSlugForAlias('inv-old');
    expect(mockAliasMaybeSingle).toHaveBeenCalledTimes(2);
  });

  it('re-checks liveness on a mapping cache hit so a reclaimed (renamed-back) slug stops redirecting', async () => {
    vi.useFakeTimers();
    try {
      // Alias 'rn' -> merchant currently 'rn-new'; 'rn' is not live (retired).
      mockAliasMaybeSingle.mockResolvedValue({
        data: { merchants: { slug: 'rn-new' } },
        error: null,
      });
      mockMerchantMaybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getCurrentSlugForAlias('rn')).toBe('rn-new');

      // Merchant renames BACK: 'rn' is a live merchant slug again.
      mockMerchantMaybeSingle.mockResolvedValue({
        data: { id: 'live-again' },
        error: null,
      });

      // Within LIVENESS_TTL the stale (false) liveness is still cached: the loop
      // window is bounded, not zero — it still briefly redirects.
      expect(await getCurrentSlugForAlias('rn')).toBe('rn-new');

      // After LIVENESS_TTL the liveness re-check runs on the mapping cache hit,
      // sees 'rn' is live, and stops redirecting — breaking the rename-back loop.
      vi.advanceTimersByTime(11_000);
      expect(await getCurrentSlugForAlias('rn')).toBeNull();

      // The alias MAPPING itself was fetched once and served from cache after.
      expect(mockAliasMaybeSingle).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('getCurrentSlugForAliasStrict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockMerchantMaybeSingle.mockResolvedValue({ data: null, error: null });
  });

  it('resolves aliases and nulls exactly like the lenient variant', async () => {
    mockAliasMaybeSingle.mockResolvedValue({
      data: { merchants: { slug: 'strict-new' } },
      error: null,
    });
    expect(await getCurrentSlugForAliasStrict('strict-old')).toBe('strict-new');

    mockAliasMaybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await getCurrentSlugForAliasStrict('strict-never')).toBeNull();
    // Liveness ran once (for strict-old); the null mapping skips it.
    expect(mockMerchantMaybeSingle).toHaveBeenCalledTimes(1);
  });

  it('throws on an alias-lookup DB error instead of returning null', async () => {
    mockAliasMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    });
    await expect(getCurrentSlugForAliasStrict('strict-err')).rejects.toThrow(
      /alias lookup failed/
    );
    // The failure is not cached as a negative: a retry re-fetches.
    mockAliasMaybeSingle.mockResolvedValue({
      data: { merchants: { slug: 'strict-recovered' } },
      error: null,
    });
    expect(await getCurrentSlugForAliasStrict('strict-err')).toBe(
      'strict-recovered'
    );
  });

  it('throws on a liveness-lookup DB error when an alias mapping exists', async () => {
    mockAliasMaybeSingle.mockResolvedValue({
      data: { merchants: { slug: 'strict-live-new' } },
      error: null,
    });
    mockMerchantMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    });
    await expect(
      getCurrentSlugForAliasStrict('strict-live-err')
    ).rejects.toThrow(/liveness lookup failed/);
  });

  it('still returns null when a live merchant owns the slug', async () => {
    mockAliasMaybeSingle.mockResolvedValue({
      data: { merchants: { slug: 'someone-else' } },
      error: null,
    });
    mockMerchantMaybeSingle.mockResolvedValue({
      data: { id: 'live-merchant' },
      error: null,
    });
    expect(await getCurrentSlugForAliasStrict('strict-live')).toBeNull();
  });
});
