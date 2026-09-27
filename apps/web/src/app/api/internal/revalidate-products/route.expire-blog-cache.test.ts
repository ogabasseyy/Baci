import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExpireProductBlogCache = vi.fn();
const mockRevalidateProducts = vi.fn();
const mockRevalidateProductSlugs = vi.fn();

vi.mock('@/env', () => ({
  getInternalApiSecret: () => 'internal-secret',
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
}));
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: (...args: unknown[]) =>
    mockExpireProductBlogCache(...args),
}));
vi.mock('@/lib/authoritative-product-purge-enrichment', () => ({
  enrichProductPurgeEntries: vi.fn(),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: vi.fn(),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: vi.fn(),
}));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

import { POST } from './route';

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

describe('internal product revalidation blog expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hard-expires only the merchant blog tag in the request context', async () => {
    // Arrange
    const merchantId = 'merchant-1';

    // Act
    const response = await POST(
      request({ merchantId, expireProductBlogCache: true })
    );

    // Assert
    expect(response.status).toBe(200);
    expect(mockExpireProductBlogCache).toHaveBeenCalledWith(merchantId);
    expect(mockRevalidateProducts).not.toHaveBeenCalled();
  });

  it('hard-expires forwarded product slugs before the caller evicts the edge', async () => {
    // Arrange: standalone workers forward the resolved slugs because their
    // local per-slug revalidation is a no-op. The worker schedules the edge
    // purge right after this returns, so SWR would re-seed the edge.
    const merchantId = 'merchant-1';

    // Act
    const response = await POST(
      request({
        merchantId,
        expireProductBlogCache: true,
        productSlugs: ['iphone-15'],
      })
    );

    // Assert
    expect(response.status).toBe(200);
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
      merchantId,
      ['iphone-15'],
      { expireImmediately: true }
    );
  });
});
