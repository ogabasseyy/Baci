import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRevalidateProductsReliable = vi.fn();
vi.mock('@/lib/revalidate-products-reliable', () => ({
  revalidateProductsReliable: (...args: unknown[]) =>
    mockRevalidateProductsReliable(...args),
}));

import { commitBumpaProducts } from '@/lib/import-commit/commit-bumpa-products';
import type { NormalizedImportedProduct } from '@/lib/imports/bumpa/bumpa-types';

function createProduct(
  overrides: Partial<NormalizedImportedProduct> = {}
): NormalizedImportedProduct {
  return {
    sourcePlatform: 'bumpa',
    externalSourceId: 'prod-1',
    title: 'Imported Phone',
    description: 'Premium device',
    sku: 'SKU-1',
    price: 150000,
    currency: 'NGN',
    stock: 5,
    manageStock: true,
    status: 'active',
    images: ['https://example.com/phone.jpg'],
    category: 'Phones',
    sourceCreatedAt: '2026-01-01T00:00:00.000Z',
    sourceUpdatedAt: '2026-02-01T00:00:00.000Z',
    importMetadata: { source: 'bumpa' },
    ...overrides,
  };
}

describe('commitBumpaProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when loading existing products fails', async () => {
    const loadQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
    };
    loadQuery.select.mockReturnValue(loadQuery);
    loadQuery.eq.mockReturnValue(loadQuery);
    loadQuery.order.mockReturnValue(loadQuery);
    loadQuery.range.mockResolvedValue({
      data: null,
      error: { message: 'load failed' },
    });

    const supabase = {
      from: vi.fn().mockReturnValue(loadQuery),
    } as unknown as SupabaseClient;

    await expect(
      commitBumpaProducts({
        supabase,
        merchantId: 'merchant-1',
        importJobId: 'job-1',
        products: [createProduct()],
      })
    ).rejects.toThrow('Failed to load existing products: load failed');
  });

  it('throws when updating an imported product fails', async () => {
    const loadQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
    };
    loadQuery.select.mockReturnValue(loadQuery);
    loadQuery.eq.mockReturnValue(loadQuery);
    loadQuery.order.mockReturnValue(loadQuery);
    loadQuery.range.mockResolvedValue({
      data: [
        {
          id: 'existing-product',
          slug: 'imported-phone',
          external_source: 'bumpa',
          external_id: 'prod-1',
        },
      ],
      error: null,
    });

    const updateQuery = {
      update: vi.fn(),
      eq: vi.fn(),
    };
    updateQuery.update.mockReturnValue(updateQuery);
    // Chained .eq('id', …).eq('merchant_id', …): first is chainable, last resolves.
    updateQuery.eq.mockReturnValueOnce(updateQuery).mockResolvedValueOnce({
      error: { message: 'update failed' },
    });

    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(loadQuery)
        .mockReturnValueOnce(updateQuery),
    } as unknown as SupabaseClient;

    await expect(
      commitBumpaProducts({
        supabase,
        merchantId: 'merchant-1',
        importJobId: 'job-1',
        products: [createProduct()],
      })
    ).rejects.toThrow('Failed to update imported product: update failed');
  });

  it('throws when inserting a new imported product fails', async () => {
    const loadQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
    };
    loadQuery.select.mockReturnValue(loadQuery);
    loadQuery.eq.mockReturnValue(loadQuery);
    loadQuery.order.mockReturnValue(loadQuery);
    loadQuery.range.mockResolvedValue({
      data: [],
      error: null,
    });

    const insertQuery = {
      insert: vi.fn(),
    };
    insertQuery.insert.mockResolvedValue({
      error: { message: 'insert failed' },
    });

    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(loadQuery)
        .mockReturnValueOnce(insertQuery),
    } as unknown as SupabaseClient;

    await expect(
      commitBumpaProducts({
        supabase,
        merchantId: 'merchant-1',
        importJobId: 'job-1',
        products: [createProduct()],
      })
    ).rejects.toThrow('Failed to create imported product: insert failed');
  });
});
