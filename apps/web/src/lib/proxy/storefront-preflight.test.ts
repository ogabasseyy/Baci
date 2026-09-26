import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./blog-preflight', () => ({
  resolveStorefrontBlogPostHardStatus: vi.fn(),
  resolveStorefrontBlogListingHardStatus: vi.fn(),
}));
vi.mock('./compare-preflight', () => ({
  resolveStorefrontComparePageHardStatus: vi.fn(),
}));
vi.mock('./pdp-preflight', () => ({
  resolveStorefrontPdpCanonicalRedirect: vi.fn(),
  resolveStorefrontPdpHardNotFound: vi.fn(),
}));

import { resolveStorefrontBlogPostHardStatus } from './blog-preflight';
import {
  resolveStorefrontPdpCanonicalRedirect,
  resolveStorefrontPdpHardNotFound,
} from './pdp-preflight';
import { runStorefrontPreflight } from './storefront-preflight';

describe('storefront preflight order', () => {
  it('returns a blog redirect before reaching PDP canonicalization', async () => {
    vi.mocked(resolveStorefrontBlogPostHardStatus).mockResolvedValue(
      NextResponse.redirect('https://shop.example/blog/new', 308)
    );
    const response = await runStorefrontPreflight({
      request: new NextRequest('https://shop.example/blog/old'),
      pathname: '/blog/old',
      hostname: 'shop.example',
      userAgent: 'Mozilla',
      merchantIdentifier: 'shop',
    });
    expect(response?.status).toBe(308);
    expect(resolveStorefrontPdpCanonicalRedirect).not.toHaveBeenCalled();
  });

  it('stops after a canonical verdict explicitly suppresses hard-not-found', async () => {
    vi.mocked(resolveStorefrontBlogPostHardStatus).mockResolvedValue(null);
    vi.mocked(resolveStorefrontPdpCanonicalRedirect).mockResolvedValue({
      response: null,
      skipHardNotFound: true,
    });
    await expect(
      runStorefrontPreflight({
        request: new NextRequest('https://shop.example/phones/iphone'),
        pathname: '/phones/iphone',
        hostname: 'shop.example',
        userAgent: 'Mozilla',
        merchantIdentifier: 'shop',
      })
    ).resolves.toBeNull();
    expect(resolveStorefrontPdpHardNotFound).not.toHaveBeenCalled();
  });
});
