import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetInternalApiSecret = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockCreatePublicClient = vi.fn();
vi.mock('@/env', () => ({
  getInternalApiSecret: () => mockGetInternalApiSecret(),
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: vi.fn(),
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
}));
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: vi.fn(),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: vi.fn(),
}));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: (...args: unknown[]) => mockCreatePublicClient(...args),
  createClient: (...args: unknown[]) => mockCreatePublicClient(...args),
}));

import { POST } from './route';

const SECRET = 'test-internal-secret';
const MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

function request(body: unknown, authHeader?: string): NextRequest {
  return new NextRequest(
    'https://app.usebaci.com/api/internal/revalidate-products',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }
  );
}

describe('POST /api/internal/revalidate-products slug chunks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInternalApiSecret.mockReturnValue(SECRET);
    mockCreatePublicClient.mockReturnValue({ from: vi.fn() });
  });

  it('busts a separately supplied complete per-slug set without an edge purge', async () => {
    const productSlugs = ['phone-1', 'phone-2', 'phone-3'];
    const res = await POST(
      request({ merchantId: MERCHANT_ID, productSlugs }, `Bearer ${SECRET}`)
    );

    expect(res.status).toBe(200);
    // Hard-expired even without purge inputs: a later control-metadata
    // chunk may schedule an edge purge over these tags.
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
      MERCHANT_ID,
      productSlugs,
      { expireImmediately: true }
    );
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
  });
});
