import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedImportedProduct } from '@/lib/imports/bumpa/bumpa-types';

const mockRevalidateProductsReliable = vi.fn();
vi.mock('@/lib/revalidate-products-reliable', () => ({
  revalidateProductsReliable: (...args: unknown[]) =>
    mockRevalidateProductsReliable(...args),
}));

import { commitBumpaProducts } from './commit-bumpa-products';

function createProduct(index: number): NormalizedImportedProduct {
  return {
    sourcePlatform: 'bumpa',
    externalSourceId: `external-${index}`,
    title: `Imported Phone ${index}`,
    description: 'Imported product',
    sku: `SKU-${index}`,
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
  };
}

function chainableQuery() {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.range = vi.fn().mockResolvedValue({ data: [], error: null });
  return query;
}

describe('commitBumpaProducts high-cardinality purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests a hostname purge when more than 1000 products change', async () => {
    const loadQuery = chainableQuery();
    const insertQuery = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const merchantsQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { slug: 'ogabassey' },
        error: null,
      }),
    };
    merchantsQuery.select.mockReturnValue(merchantsQuery);
    merchantsQuery.eq.mockReturnValue(merchantsQuery);

    let productCall = 0;
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'merchants') return merchantsQuery;
        productCall += 1;
        return productCall === 1 ? loadQuery : insertQuery;
      }),
    } as unknown as SupabaseClient;

    await commitBumpaProducts({
      supabase,
      merchantId: 'merchant-1',
      importJobId: 'job-1',
      products: Array.from({ length: 1001 }, (_, index) =>
        createProduct(index)
      ),
    });

    expect(mockRevalidateProductsReliable).toHaveBeenCalledWith(
      'merchant-1',
      expect.objectContaining({
        merchantSlug: 'ogabassey',
        products: [{ slug: 'imported-phone-0', category: 'Phones' }],
        supabase,
        purgeWholeStorefront: true,
      })
    );
    const [, options] = mockRevalidateProductsReliable.mock.calls[0] as [
      string,
      { nextProductSlugs: string[] },
    ];
    expect(options.nextProductSlugs).toHaveLength(1001);
    expect(options.nextProductSlugs[0]).toBe('imported-phone-0');
    expect(options.nextProductSlugs.at(-1)).toBe('imported-phone-1000');
  });

  it('requests a hostname purge when an existing product changes category', async () => {
    const loadQuery = chainableQuery();
    loadQuery.range = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'existing-product',
          slug: 'imported-phone',
          category: 'Old Category',
          external_source: 'bumpa',
          external_id: 'external-0',
        },
      ],
      error: null,
    });
    const updateQuery = {
      update: vi.fn(),
      eq: vi.fn(),
    };
    updateQuery.update.mockReturnValue(updateQuery);
    updateQuery.eq.mockReturnValueOnce(updateQuery).mockResolvedValueOnce({
      error: null,
    });
    const merchantsQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { slug: 'ogabassey' },
        error: null,
      }),
    };
    merchantsQuery.select.mockReturnValue(merchantsQuery);
    merchantsQuery.eq.mockReturnValue(merchantsQuery);

    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(loadQuery)
        .mockReturnValueOnce(updateQuery)
        .mockReturnValueOnce(merchantsQuery),
    } as unknown as SupabaseClient;

    await commitBumpaProducts({
      supabase,
      merchantId: 'merchant-1',
      importJobId: 'job-1',
      products: [createProduct(0)],
    });

    expect(mockRevalidateProductsReliable).toHaveBeenCalledWith(
      'merchant-1',
      expect.objectContaining({
        purgeWholeStorefront: true,
      })
    );
  });
});
