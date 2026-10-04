import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/internal-api-secret', () => ({
  getInternalApiSecret: () => 'test-secret',
}));
vi.mock('@/lib/storefront-product-canonical-redirect', () => ({
  getStorefrontProductCanonicalRedirectResult: vi.fn(),
}));
vi.mock('@/lib/storefront-product-slug-membership', () => ({
  resolveStorefrontProductSlugResolution: vi.fn(),
}));
vi.mock('@/lib/storefront-compare-hub-status', () => ({
  resolveStorefrontCompareHubStatus: vi.fn(),
}));

import { getStorefrontProductCanonicalRedirectResult } from '@/lib/storefront-product-canonical-redirect';
import {
  resolveStorefrontPdpCanonicalRedirect,
  resolveStorefrontPdpHardNotFound,
} from './pdp-preflight';

describe('PDP preflight', () => {
  it('skips hard membership reads for UUID product links', async () => {
    await expect(
      resolveStorefrontPdpHardNotFound(
        new NextRequest(
          'https://shop.example/phones/123e4567-e89b-12d3-a456-426614174000',
          { headers: { accept: 'text/html' } }
        ),
        '/phones/123e4567-e89b-12d3-a456-426614174000',
        'shop.example',
        'Mozilla',
        'shop'
      )
    ).resolves.toBeNull();
  });

  it('redirects a confirmed canonical alias and suppresses the later hard-404', async () => {
    vi.mocked(getStorefrontProductCanonicalRedirectResult).mockResolvedValue({
      kind: 'redirect',
      redirectPath: '/phones/iphone-15',
    });
    const result = await resolveStorefrontPdpCanonicalRedirect(
      new NextRequest('https://shop.example/phones/old-iphone'),
      '/phones/old-iphone',
      'shop.example',
      'shop'
    );
    expect(result.skipHardNotFound).toBe(true);
    expect(result.response?.status).toBe(308);
    expect(result.response?.headers.get('location')).toBe(
      'https://shop.example/phones/iphone-15'
    );
  });
});
