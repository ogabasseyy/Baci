import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  resolveStorefrontBlogListingHardStatus,
  resolveStorefrontBlogPostHardStatus,
} from './blog-preflight';
import { resolveStorefrontComparePageHardStatus } from './compare-preflight';
import {
  resolveStorefrontPdpCanonicalRedirect,
  resolveStorefrontPdpHardNotFound,
} from './pdp-preflight';
import { runStorefrontPreflight } from './storefront-preflight';

describe('storefront preflight order', () => {
  const helpers = [
    resolveStorefrontBlogPostHardStatus,
    resolveStorefrontBlogListingHardStatus,
    resolveStorefrontComparePageHardStatus,
    resolveStorefrontPdpCanonicalRedirect,
    resolveStorefrontPdpHardNotFound,
  ];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveStorefrontBlogPostHardStatus).mockResolvedValue(null);
    vi.mocked(resolveStorefrontBlogListingHardStatus).mockResolvedValue(null);
    vi.mocked(resolveStorefrontComparePageHardStatus).mockResolvedValue(null);
    vi.mocked(resolveStorefrontPdpCanonicalRedirect).mockResolvedValue({
      response: null,
      skipHardNotFound: false,
    });
    vi.mocked(resolveStorefrontPdpHardNotFound).mockResolvedValue(null);
  });

  it.each<{ method: string; headers: Record<string, string> }>([
    { method: 'POST', headers: {} },
    { method: 'GET', headers: { rsc: '1' } },
    { method: 'GET', headers: { 'next-router-prefetch': '' } },
    { method: 'GET', headers: { 'next-router-state-tree': '' } },
    { method: 'GET', headers: { 'sec-fetch-dest': 'empty' } },
  ])('skips all five preflight helpers for $method $headers', async (init) => {
    const response = await runStorefrontPreflight({
      request: new NextRequest('https://shop.example/phones/iphone', init),
      pathname: '/phones/iphone',
      hostname: 'shop.example',
      userAgent: 'Mozilla',
      merchantIdentifier: 'shop',
    });

    expect(response).toBeNull();
    expect(
      helpers.map((helper) => vi.mocked(helper).mock.calls.length)
    ).toEqual([0, 0, 0, 0, 0]);
  });

  it.each([
    'GET',
    'HEAD',
  ])('preserves %s document preflight order', async (method) => {
    const response = await runStorefrontPreflight({
      request: new NextRequest('https://shop.example/phones/iphone', {
        method,
        headers: { 'sec-fetch-dest': 'document' },
      }),
      pathname: '/phones/iphone',
      hostname: 'shop.example',
      userAgent: 'Mozilla',
      merchantIdentifier: 'shop',
    });

    expect(response).toBeNull();
    expect(
      helpers.map((helper) => vi.mocked(helper).mock.calls.length)
    ).toEqual([1, 1, 1, 1, 1]);
    const order = helpers.map(
      (helper) => vi.mocked(helper).mock.invocationCallOrder[0]
    );
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

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
