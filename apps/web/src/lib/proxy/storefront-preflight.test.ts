import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => ({
    rpc: (...args: unknown[]) => ({
      abortSignal: () => mockRpc(...args),
    }),
  }),
}));

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

import { resetStorefrontPreflightRpcForTests } from '@/lib/storefront-preflight-rpc';
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

function createPreflightArgs(
  pathname: string,
  init?: ConstructorParameters<typeof NextRequest>[1]
) {
  return {
    request: new NextRequest(
      `https://shop.example${pathname}`,
      init ?? { method: 'GET', headers: { 'sec-fetch-dest': 'document' } }
    ),
    pathname,
    hostname: 'shop.example',
    userAgent: 'Mozilla',
    merchantIdentifier: 'shop',
  };
}

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
    vi.unstubAllEnvs();
    resetStorefrontPreflightRpcForTests();
    mockRpc.mockResolvedValue({
      data: { is_published: true },
      error: null,
    });
    vi.mocked(resolveStorefrontBlogPostHardStatus).mockResolvedValue(null);
    vi.mocked(resolveStorefrontBlogListingHardStatus).mockResolvedValue(null);
    vi.mocked(resolveStorefrontComparePageHardStatus).mockResolvedValue(null);
    vi.mocked(resolveStorefrontPdpCanonicalRedirect).mockResolvedValue({
      response: null,
      skipHardNotFound: false,
    });
    vi.mocked(resolveStorefrontPdpHardNotFound).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetStorefrontPreflightRpcForTests();
  });

  it.each<{ method: string; headers: Record<string, string> }>([
    { method: 'POST', headers: {} },
    { method: 'GET', headers: { rsc: '1' } },
    { method: 'GET', headers: { 'next-router-prefetch': '' } },
    { method: 'GET', headers: { 'next-router-state-tree': '' } },
    { method: 'GET', headers: { 'sec-fetch-dest': 'empty' } },
  ])('skips all five preflight helpers for $method $headers', async (init) => {
    const response = await runStorefrontPreflight(
      createPreflightArgs('/phones/iphone', init)
    );

    expect(response).toBeNull();
    expect(
      helpers.map((helper) => vi.mocked(helper).mock.calls.length)
    ).toEqual([0, 0, 0, 0, 0]);
  });

  it.each([
    'GET',
    'HEAD',
  ])('preserves %s document preflight order', async (method) => {
    const response = await runStorefrontPreflight(
      createPreflightArgs('/phones/iphone', {
        method,
        headers: { 'sec-fetch-dest': 'document' },
      })
    );

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
    const response = await runStorefrontPreflight(
      createPreflightArgs('/blog/old')
    );
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
      runStorefrontPreflight(createPreflightArgs('/phones/iphone'))
    ).resolves.toBeNull();
    expect(resolveStorefrontPdpHardNotFound).not.toHaveBeenCalled();
  });

  describe('nested taxonomy fast-path hard 404', () => {
    it.each([
      ['invalid brand hub', '/smartphones/brands/nonexistent-brand'],
      [
        'invalid model family hub',
        '/smartphones/brands/samsung/families/nonexistent-family',
      ],
      ['invalid price band hub', '/smartphones/best-under/nonexistent-band'],
      ['invalid graphics hub', '/gaming-laptops/graphics/nonexistent-card'],
    ])('returns 404 for %s when merchant RPC confirms published store', async (_, pathname) => {
      const response = await runStorefrontPreflight(
        createPreflightArgs(pathname)
      );

      expect(response).not.toBeNull();
      expect(response?.status).toBe(404);
      expect(mockRpc).toHaveBeenCalledWith('resolve_storefront_auth_merchant', {
        p_identifier: 'shop',
      });
    });

    it.each([
      ['valid brand hub', '/smartphones/brands/samsung'],
      [
        'valid model family hub',
        '/smartphones/brands/samsung/families/galaxy-s',
      ],
      ['valid price band hub', '/smartphones/best-under/under-1m'],
      ['valid graphics hub', '/gaming-laptops/graphics/rtx-4070'],
    ])('passes through (%s) without verifying merchant publication', async (_, pathname) => {
      const response = await runStorefrontPreflight(
        createPreflightArgs(pathname)
      );

      expect(response).toBeNull();
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('does not intercept 1-segment category routes', async () => {
      const response = await runStorefrontPreflight(
        createPreflightArgs('/smartphones')
      );

      expect(response).toBeNull();
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('fails open when merchant RPC returns an error', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database connection timeout' },
      });

      const response = await runStorefrontPreflight(
        createPreflightArgs('/smartphones/brands/nonexistent-brand')
      );

      expect(response).toBeNull();
    });

    it('fails open when merchant RPC rejects or times out', async () => {
      mockRpc.mockRejectedValueOnce(new Error('RPC timeout'));

      const response = await runStorefrontPreflight(
        createPreflightArgs('/smartphones/brands/nonexistent-brand')
      );

      expect(response).toBeNull();
    });

    it('fails open when merchant is unpublished', async () => {
      mockRpc.mockResolvedValueOnce({
        data: { is_published: false },
        error: null,
      });

      const response = await runStorefrontPreflight(
        createPreflightArgs('/smartphones/brands/nonexistent-brand')
      );

      expect(response).toBeNull();
    });

    it('fails open on non-production preview deployments without calling Supabase RPC', async () => {
      vi.stubEnv('VERCEL_ENV', 'preview');

      const response = await runStorefrontPreflight(
        createPreflightArgs('/smartphones/brands/nonexistent-brand')
      );

      expect(response).toBeNull();
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('ignores query-bearing requests to preserve search and filter variants', async () => {
      const response = await runStorefrontPreflight(
        createPreflightArgs('/smartphones/brands/nonexistent-brand?page=2')
      );

      expect(response).toBeNull();
      expect(mockRpc).not.toHaveBeenCalled();
    });
  });
});
