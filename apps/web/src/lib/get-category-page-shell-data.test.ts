import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedCategoryPageShellData } from '@/lib/cached-category-page-shell';
import type { CachedCategoryPageShellData } from '@/lib/cached-category-page-shell-types';
import { getCategoryFallbackName } from './get-category-fallback-name';
import { getCategoryPageShellData } from './get-category-page-shell-data';

vi.mock('@/lib/cached-category-page-shell', () => ({
  getCachedCategoryPageShellData: vi.fn(),
}));

describe('getCategoryPageShellData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the cached shell when the loader succeeds', async () => {
    const shell = {
      isCollection: false,
      category: null,
      fallbackName: 'Laptops',
      fallbackDescription: 'Browse our collection of Laptops products.',
      isInactiveCategory: false,
      categoryQueryFailed: false,
      productScope: { kind: 'none' as const },
    } satisfies CachedCategoryPageShellData;
    vi.mocked(getCachedCategoryPageShellData).mockResolvedValueOnce(shell);

    await expect(
      getCategoryPageShellData('merchant-1', 'laptops')
    ).resolves.toEqual(shell);
  });

  it('bugfix: fails open with a deterministic fallback when the cached shell throws', async () => {
    vi.mocked(getCachedCategoryPageShellData).mockRejectedValueOnce(
      new Error('statement timeout')
    );

    await expect(
      getCategoryPageShellData('merchant-1', 'phones-and-tablets')
    ).resolves.toEqual({
      isCollection: false,
      category: null,
      fallbackName: getCategoryFallbackName('phones-and-tablets'),
      fallbackDescription:
        'Browse our collection of Phones And Tablets products.',
      isInactiveCategory: false,
      categoryQueryFailed: true,
      productScope: { kind: 'none' },
    });
  });
});
