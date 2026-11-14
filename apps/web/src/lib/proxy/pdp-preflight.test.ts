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

import { resolveStorefrontCompareHubStatus } from '@/lib/storefront-compare-hub-status';
import { getStorefrontProductCanonicalRedirectResult } from '@/lib/storefront-product-canonical-redirect';
import { resolveStorefrontProductSlugResolution } from '@/lib/storefront-product-slug-membership';
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

  it.each([
    'GET',
    'HEAD',
  ] as const)('returns hard 404 with X-Robots-Tag: noindex, follow on %s for missing PDPs with query params', async (method) => {
    vi.mocked(resolveStorefrontProductSlugResolution).mockResolvedValue({
      kind: 'missing',
    });

    const response = await resolveStorefrontPdpHardNotFound(
      new NextRequest(
        'https://shop.example/phones/dead-phone?utm_source=fb&condition=used',
        {
          method,
          headers: { accept: 'text/html' },
        }
      ),
      '/phones/dead-phone',
      'shop.example',
      'Mozilla',
      'shop'
    );

    expect(response?.status).toBe(404);
    expect(response?.headers.get('X-Robots-Tag')).toBe('noindex, follow');
  });

  it.each([
    'GET',
    'HEAD',
  ] as const)('returns null on %s for valid or uncertain PDPs with query params', async (method) => {
    vi.mocked(resolveStorefrontProductSlugResolution).mockResolvedValue({
      kind: 'present-or-unknown',
    });

    const response = await resolveStorefrontPdpHardNotFound(
      new NextRequest(
        'https://shop.example/phones/iphone-15?utm_source=fb&condition=used',
        {
          method,
          headers: { accept: 'text/html' },
        }
      ),
      '/phones/iphone-15',
      'shop.example',
      'Mozilla',
      'shop'
    );

    expect(response).toBeNull();
  });

  it.each([
    'GET',
    'HEAD',
  ] as const)('returns hard 404 with X-Robots-Tag: noindex, follow on %s for confirmed-empty compare hubs with query params', async (method) => {
    vi.mocked(resolveStorefrontCompareHubStatus).mockResolvedValue({
      kind: 'empty',
    });

    const response = await resolveStorefrontPdpHardNotFound(
      new NextRequest(
        'https://shop.example/phones/compare?utm_source=email&sort=price',
        {
          method,
          headers: { accept: 'text/html' },
        }
      ),
      '/phones/compare',
      'shop.example',
      'Mozilla',
      'shop'
    );

    expect(response?.status).toBe(404);
    expect(response?.headers.get('X-Robots-Tag')).toBe('noindex, follow');
  });
});

it.each([
  ['https://shop.example/collections/all', '/collections/all', 'shop.example'],
  [
    'https://shop.usebaci.com/collections/all',
    '/collections/all',
    'shop.usebaci.com',
  ],
  [
    'https://usebaci.com/qa1/collections/all',
    '/qa1/collections/all',
    'usebaci.com',
  ],
])('never treats collection documents as categorized PDPs: %s', async (url, path, host) => {
  vi.clearAllMocks();
  const request = new NextRequest(url, { headers: { accept: 'text/html' } });
  expect(
    await resolveStorefrontPdpHardNotFound(
      request,
      path,
      host,
      'Mozilla',
      'qa1'
    )
  ).toBeNull();
  const result = await resolveStorefrontPdpCanonicalRedirect(
    request,
    path,
    host,
    'qa1'
  );
  expect(result.response).toBeNull();
  expect(getStorefrontProductCanonicalRedirectResult).not.toHaveBeenCalled();
});
