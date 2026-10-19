import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/domain-cache-simple', () => ({
  getCustomDomainForSlug: vi.fn(),
}));
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue(null),
}));

import { getCustomDomainForSlug } from '@/lib/domain-cache-simple';
import { getRequestSubdomain, runSubdomainRouting } from './subdomain-routing';

describe('subdomain routing', () => {
  beforeEach(() => {
    vi.mocked(getCustomDomainForSlug).mockReset();
  });

  it.each([
    'GET',
    'HEAD',
    'POST',
    'OPTIONS',
  ])('forwards %s API requests without a forward-domain lookup', async (method) => {
    const response = await runSubdomainRouting(
      new NextRequest('https://shop.usebaci.com/api/orders', { method }),
      '/api/orders',
      'shop.usebaci.com',
      'Mozilla',
      'shop'
    );
    expect(response?.headers.get('x-middleware-next')).toBe('1');
    expect(response?.headers.get('x-middleware-request-x-merchant-slug')).toBe(
      'shop'
    );
    expect(getCustomDomainForSlug).not.toHaveBeenCalled();
  });

  it.each([
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
  ])('rewrites %s storefront requests without a forward-domain lookup', async (method) => {
    const response = await runSubdomainRouting(
      new NextRequest('https://shop.usebaci.com/products/phone', { method }),
      '/products/phone',
      'shop.usebaci.com',
      'Mozilla',
      'shop'
    );
    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      'https://shop.usebaci.com/shop/products/phone?__baci_metadata_cache_bucket=streaming'
    );
    expect(getCustomDomainForSlug).not.toHaveBeenCalled();
  });

  it.each([
    'GET',
    'HEAD',
  ])('preserves %s custom-domain redirects and query strings', async (method) => {
    vi.mocked(getCustomDomainForSlug).mockResolvedValue('shop.example');
    const response = await runSubdomainRouting(
      new NextRequest('https://shop.usebaci.com/products/phone?ref=email', {
        method,
      }),
      '/products/phone',
      'shop.usebaci.com',
      'Mozilla',
      'shop'
    );
    expect(response?.headers.get('location')).toBe(
      'https://shop.example/products/phone?ref=email'
    );
    expect(response?.status).toBe(301);
    expect(getCustomDomainForSlug).toHaveBeenCalledExactlyOnceWith('shop');
  });

  it('preserves the terms alias redirect on the custom domain', async () => {
    vi.mocked(getCustomDomainForSlug).mockResolvedValue('shop.example');
    const response = await runSubdomainRouting(
      new NextRequest('https://shop.usebaci.com/terms-of-service?ref=email'),
      '/terms-of-service',
      'shop.usebaci.com',
      'Mozilla',
      'shop'
    );
    expect(response?.headers.get('location')).toBe(
      'https://shop.example/terms?ref=email'
    );
    expect(response?.status).toBe(301);
  });

  it('extracts local and platform merchant labels without accepting nested labels', () => {
    expect(getRequestSubdomain('shop.localhost')).toBe('shop');
    expect(getRequestSubdomain('shop.usebaci.com')).toBe('shop');
    expect(getRequestSubdomain('deep.shop.usebaci.com')).toBeNull();
  });

  it('does not claim requests without a subdomain', async () => {
    await expect(
      runSubdomainRouting(
        new NextRequest('https://usebaci.com/products'),
        '/products',
        'usebaci.com',
        'Mozilla',
        null
      )
    ).resolves.toBeNull();
  });
});
