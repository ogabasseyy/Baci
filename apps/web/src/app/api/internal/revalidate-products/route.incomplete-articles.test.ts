import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetInternalApiSecret = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockScheduleStorefrontHostnamePurge = vi.fn();
const mockCreatePublicClient = vi.fn();
vi.mock('@/env', () => ({
  getInternalApiSecret: () => mockGetInternalApiSecret(),
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: vi.fn(),
  revalidateProductSlugs: vi.fn(),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
}));
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: vi.fn(),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockScheduleStorefrontHostnamePurge(...args),
}));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: (...args: unknown[]) => mockCreatePublicClient(...args),
  createClient: (...args: unknown[]) => mockCreatePublicClient(...args),
}));

import { POST } from './route';

const SECRET = 'test-internal-secret';
const MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

function makePublicClient() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { slug: 'ogabassey' }, error: null }),
          in: () =>
            Promise.resolve({
              data: table === 'products' ? [] : [],
              error: null,
            }),
        }),
      }),
    }),
  };
}

function request(body: unknown): NextRequest {
  return new NextRequest(
    'https://app.usebaci.com/api/internal/revalidate-products',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify(body),
    }
  );
}

describe('POST /api/internal/revalidate-products incomplete article lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInternalApiSecret.mockReturnValue(SECRET);
    mockCreatePublicClient.mockReturnValue(makePublicClient());
  });

  it('evicts the hostname when the article lookup preserves no rows', async () => {
    // The relationship client cannot serve this projection, so the lookup
    // throws with zero rows preserved; the route must not trust the empty
    // set as "no linked articles".
    const res = await POST(
      request({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        // UUID id so the relationship lookup actually runs (non-UUID ids
        // are filtered out of the join before any row is read).
        products: [
          {
            id: '123e4567-e89b-42d3-a456-426614174000',
            slug: 'iphone-15',
          },
        ],
      })
    );

    expect(res.status).toBe(200);
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontHostnamePurge).toHaveBeenCalledWith(
      'ogabassey'
    );
  });
});
