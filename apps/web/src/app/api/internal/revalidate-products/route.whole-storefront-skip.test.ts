import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnrichProductPurgeEntries = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
const mockScheduleStorefrontHostnamePurge = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();

vi.mock('@/env', () => ({
  getInternalApiSecret: () => 'internal-secret',
}));
vi.mock('@/lib/authoritative-product-purge-enrichment', () => ({
  enrichProductPurgeEntries: (...args: unknown[]) =>
    mockEnrichProductPurgeEntries(...args),
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: vi.fn(),
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
}));
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: vi.fn(),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockScheduleStorefrontHostnamePurge(...args),
}));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { slug: 'ogabassey' }, error: null }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

import { POST } from './route';

const MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

function request(body: unknown) {
  return new NextRequest(
    'https://app.usebaci.com/api/internal/revalidate-products',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer internal-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
}

describe('internal product revalidation whole-storefront skip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips article enrichment for whole-storefront purges but keeps per-slug busts', async () => {
    // Arrange: the standalone import path sets purgeWholeStorefront for
    // category moves and bounded high-cardinality imports.
    const products = [{ id: 'prod-1', slug: 'iphone-15' }];

    // Act
    const response = await POST(
      request({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        products,
        purgeWholeStorefront: true,
      })
    );

    // Assert: enrichment (with its paginated article lookups) is bypassed
    // because its entries/blog slugs are discarded for hostname purges, but
    // the per-slug Next bust still runs from the caller hints.
    expect(response.status).toBe(200);
    expect(mockEnrichProductPurgeEntries).not.toHaveBeenCalled();
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
      MERCHANT_ID,
      expect.arrayContaining(['iphone-15', 'prod-1'])
    );
    expect(mockScheduleStorefrontHostnamePurge).toHaveBeenCalledWith(
      'ogabassey'
    );
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
  });
});
