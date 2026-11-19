import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRevalidateProducts = vi.fn();
const mockScheduleProductMutationPurge = vi.fn();
const mockResolveDependentAliases = vi.fn();

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
}));
vi.mock('@/lib/resolve-dependent-legacy-product-identifiers', () => ({
  resolveDependentLegacyProductIdentifiers: (...args: unknown[]) =>
    mockResolveDependentAliases(...args),
}));
vi.mock('@/lib/schedule-product-mutation-purge', () => ({
  scheduleProductMutationPurge: (...args: unknown[]) =>
    mockScheduleProductMutationPurge(...args),
}));

import {
  scheduleDeletedProductPurge,
  scheduleUpdatedProductPurge,
} from './schedule-product-id-purge';

const supabase = {} as Parameters<
  typeof scheduleUpdatedProductPurge
>[0]['supabase'];

describe('schedule-product-id-purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveDependentAliases.mockResolvedValue({
      identifiers: ['child-1', 'old-alias'],
      incomplete: false,
    });
  });

  it('schedules current and prior update entries without calling revalidateProducts directly', async () => {
    await scheduleUpdatedProductPurge({
      supabase,
      id: 'prod-1',
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      existingProduct: {
        id: 'prod-1',
        slug: 'old-slug',
        name: 'Phone',
        category: 'Electronics',
      },
      updatedProduct: {
        id: 'prod-1',
        slug: 'new-slug',
        name: 'Phone',
        category: 'Smartphones',
      },
    });

    expect(mockScheduleProductMutationPurge).toHaveBeenCalledWith({
      supabase,
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      productIds: ['prod-1'],
      entries: [
        { slug: 'new-slug', categorySegment: 'smartphones' },
        { slug: 'old-slug', categorySegment: 'electronics' },
      ],
      dependentProductIdentifiers: ['child-1', 'old-alias'],
      dependentAliasesIncomplete: false,
    });
    expect(mockRevalidateProducts).not.toHaveBeenCalled();
  });

  it('falls back to immediate revalidateProducts when update scheduling throws', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      mockScheduleProductMutationPurge.mockImplementationOnce(() => {
        throw new Error('boom');
      });

      await scheduleUpdatedProductPurge({
        supabase,
        id: 'prod-1',
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        existingProduct: { id: 'prod-1', slug: 'phone', name: 'Phone' },
        updatedProduct: { id: 'prod-1', slug: 'phone', name: 'Phone' },
      });

      expect(mockRevalidateProducts).toHaveBeenCalledWith(
        'merchant-1',
        'phone',
        { expireImmediately: true }
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('schedules whole-storefront fallback when deleted pre-read row is missing and hard-expires on throw', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      await scheduleDeletedProductPurge({
        supabase,
        id: 'prod-1',
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        deletedProduct: null,
        preReadError: new Error('rls'),
        linkedBlogPostIds: ['post-1'],
        incompleteBlogSnapshot: false,
      });

      expect(mockScheduleProductMutationPurge).toHaveBeenCalledWith({
        supabase,
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        productIds: ['prod-1'],
        entries: [{ slug: 'prod-1', categorySegment: null }],
        blogPostIds: ['post-1'],
        purgeWholeStorefront: true,
      });
      expect(mockRevalidateProducts).not.toHaveBeenCalled();

      mockScheduleProductMutationPurge.mockImplementationOnce(() => {
        throw new Error('boom');
      });
      await scheduleDeletedProductPurge({
        supabase,
        id: 'prod-1',
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        deletedProduct: { id: 'prod-1', slug: 'phone', name: 'Phone' },
        preReadError: null,
        linkedBlogPostIds: [],
        incompleteBlogSnapshot: false,
      });

      expect(mockRevalidateProducts).toHaveBeenCalledWith(
        'merchant-1',
        undefined,
        { expireImmediately: true }
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
