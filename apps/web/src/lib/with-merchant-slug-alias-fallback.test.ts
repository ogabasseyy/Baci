import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCurrentSlugForAlias,
  getCurrentSlugForAliasStrict,
} from '@/lib/slug-alias-cache';
import { withMerchantSlugAliasFallback } from '@/lib/with-merchant-slug-alias-fallback';

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn(),
  getCurrentSlugForAliasStrict: vi.fn(),
}));

describe('withMerchantSlugAliasFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue(null);
    vi.mocked(getCurrentSlugForAliasStrict).mockResolvedValue(null);
  });

  it('returns the direct hit without consulting the alias table', async () => {
    const lookup = vi
      .fn()
      .mockResolvedValue({ data: { id: 'm1' }, error: null });

    const result = await withMerchantSlugAliasFallback('live-slug', lookup);

    expect(result.data).toEqual({ id: 'm1' });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith('live-slug');
    // A live merchant wins — never pay the alias lookup.
    expect(getCurrentSlugForAlias).not.toHaveBeenCalled();
  });

  it('resolves a retired slug via the alias table and retries with the current slug', async () => {
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('new-slug');
    const lookup = vi
      .fn()
      .mockImplementation((slug: string) =>
        Promise.resolve(
          slug === 'new-slug'
            ? { data: { id: 'm1', slug: 'new-slug' }, error: null }
            : { data: null, error: null }
        )
      );

    const result = await withMerchantSlugAliasFallback('old-slug', lookup);

    expect(result.data).toEqual({ id: 'm1', slug: 'new-slug' });
    expect(lookup).toHaveBeenNthCalledWith(1, 'old-slug');
    expect(lookup).toHaveBeenNthCalledWith(2, 'new-slug');
  });

  it('returns the not-found miss when the slug is not a retired alias', async () => {
    const lookup = vi.fn().mockResolvedValue({ data: null, error: null });

    const result = await withMerchantSlugAliasFallback('unknown', lookup);

    expect(result.data).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('does not run the alias fallback when the first lookup errors', async () => {
    const dbError = { message: 'db down' };
    const lookup = vi.fn().mockResolvedValue({ data: null, error: dbError });

    const result = await withMerchantSlugAliasFallback('any', lookup);

    expect(result.error).toBe(dbError);
    expect(getCurrentSlugForAlias).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('strict mode resolves via the strict resolver', async () => {
    vi.mocked(getCurrentSlugForAliasStrict).mockResolvedValue('new-slug');
    const lookup = vi
      .fn()
      .mockImplementation((slug: string) =>
        Promise.resolve(
          slug === 'new-slug'
            ? { data: { id: 'm1' }, error: null }
            : { data: null, error: null }
        )
      );

    const result = await withMerchantSlugAliasFallback('old-slug', lookup, {
      strict: true,
    });

    expect(result.data).toEqual({ id: 'm1' });
    expect(getCurrentSlugForAliasStrict).toHaveBeenCalledWith('old-slug');
    expect(getCurrentSlugForAlias).not.toHaveBeenCalled();
  });

  it('strict mode propagates alias-lookup failures instead of 404ing', async () => {
    vi.mocked(getCurrentSlugForAliasStrict).mockRejectedValue(
      new Error('[Slug Alias Cache] alias lookup failed for slug: old-slug')
    );
    const lookup = vi.fn().mockResolvedValue({ data: null, error: null });

    await expect(
      withMerchantSlugAliasFallback('old-slug', lookup, { strict: true })
    ).rejects.toThrow(/alias lookup failed/);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
