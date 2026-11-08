import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadCategory = vi.fn();
const mockCacheLife = vi.fn();
const mockCacheTag = vi.fn();

vi.mock('next/cache', () => ({
  cacheLife: (...args: unknown[]) => mockCacheLife(...args),
  cacheTag: (...args: unknown[]) => mockCacheTag(...args),
}));

vi.mock('@/lib/storefront-category/brand-authority-public-data', () => ({
  brandAuthorityPublicData: {
    readCategory: (...args: unknown[]) => mockReadCategory(...args),
  },
}));

import { getCachedBrandAuthorityCategory } from './get-cached-brand-authority-category';

describe('getCachedBrandAuthorityCategory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads and returns the category and registers cache tags', async () => {
    const mockCategory = { id: 'cat-123', name: 'Smartphones' };
    mockReadCategory.mockResolvedValue(mockCategory);

    const result = await getCachedBrandAuthorityCategory(
      'merchant-1',
      'smartphones'
    );

    expect(result).toEqual(mockCategory);
    expect(mockCacheLife).toHaveBeenCalledWith('storefront-page');
    expect(mockCacheTag).toHaveBeenCalledWith(
      'categories',
      'categories-merchant-1'
    );
    expect(mockReadCategory).toHaveBeenCalledWith(
      'merchant-1',
      'smartphones',
      expect.any(AbortSignal)
    );
  });

  it('returns null when category is not found or inactive', async () => {
    mockReadCategory.mockResolvedValue(null);

    const result = await getCachedBrandAuthorityCategory(
      'merchant-1',
      'laptops'
    );

    expect(result).toBeNull();
    expect(mockReadCategory).toHaveBeenCalledWith(
      'merchant-1',
      'laptops',
      expect.any(AbortSignal)
    );
  });

  it('propagates errors when readCategory throws', async () => {
    const error = new Error('Database read failure');
    mockReadCategory.mockRejectedValue(error);

    await expect(
      getCachedBrandAuthorityCategory('merchant-1', 'audio')
    ).rejects.toThrow('Database read failure');
  });

  it('times out when readCategory exceeds the timeout deadline', async () => {
    mockReadCategory.mockImplementation(
      (_merchantId: string, _categorySlug: string, signal: AbortSignal) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason);
          });
        })
    );

    await expect(
      getCachedBrandAuthorityCategory('merchant-1', 'tablets', 15)
    ).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });

  it('tolerates cacheLife/cacheTag throwing outside Next.js request context', async () => {
    mockCacheLife.mockImplementationOnce(() => {
      throw new Error(
        'cacheLife is only available in Next.js Server Components'
      );
    });
    mockReadCategory.mockResolvedValue({ id: 'cat-456', name: 'Watches' });

    const result = await getCachedBrandAuthorityCategory(
      'merchant-1',
      'watches'
    );
    expect(result).toEqual({ id: 'cat-456', name: 'Watches' });
  });
});
