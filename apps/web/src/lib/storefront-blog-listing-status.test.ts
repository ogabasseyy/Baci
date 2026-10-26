import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveStorefrontBlogListingStatus } from './storefront-blog-listing-status';
import {
  makeBlogListingRow as makeRow,
  overEncoded,
  rpcImplResolving,
} from './storefront-blog-listing-status.test-utils';
import {
  resetStorefrontPreflightRpcForTests,
  type StorefrontPreflightRpcImpl,
} from './storefront-preflight-rpc';

// getBlogAuthorBySlug only resolves profiles for the ogabassey tenant, so author
// intents must use an ogabassey identifier to reach the RPC.
const OGABASSEY = 'ogabassey.com';

describe('resolveStorefrontBlogListingStatus', () => {
  beforeEach(() => {
    resetStorefrontPreflightRpcForTests();
    // VERCEL_ENV is normally unset in vitest, which passes the transport's
    // preview gate; delete defensively in case another suite left it stubbed.
    delete process.env.VERCEL_ENV;
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('skips the RPC for over-encoded bot category-query slugs', async () => {
    const rpcImpl = vi.fn();
    const result = await resolveStorefrontBlogListingStatus({
      origin: 'https://ogabassey.com',
      identifier: 'skip-category-query.example',
      intent: {
        kind: 'category-query',
        category: overEncoded('smartphones and tablets'),
      },
      secret: 'internal-secret',
      rpcImpl: rpcImpl as unknown as StorefrontPreflightRpcImpl,
    });

    expect(result).toEqual({ kind: 'noop' });
    expect(rpcImpl).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(
      '[storefront-internal-preflight] skip',
      expect.objectContaining({
        surface: 'blog-listing-status',
        reason: 'over-encoded',
      })
    );
  });

  it('skips the RPC for extremely long category-page slugs', async () => {
    const rpcImpl = vi.fn();
    const result = await resolveStorefrontBlogListingStatus({
      origin: 'https://ogabassey.com',
      identifier: 'skip-category-page.example',
      intent: {
        kind: 'category-page',
        categorySlug: 'a'.repeat(4000),
        page: 2,
      },
      secret: 'internal-secret',
      rpcImpl: rpcImpl as unknown as StorefrontPreflightRpcImpl,
    });

    expect(result).toEqual({ kind: 'noop' });
    expect(rpcImpl).not.toHaveBeenCalled();
  });

  it('skips the RPC for unsafe listing-page category segments', async () => {
    const rpcImpl = vi.fn();
    const result = await resolveStorefrontBlogListingStatus({
      origin: 'https://ogabassey.com',
      identifier: 'skip-listing-category.example',
      intent: {
        kind: 'listing-page',
        category: overEncoded('smartphones and tablets'),
        page: 2,
      },
      secret: 'internal-secret',
      rpcImpl: rpcImpl as unknown as StorefrontPreflightRpcImpl,
    });

    expect(result).toEqual({ kind: 'noop' });
    expect(rpcImpl).not.toHaveBeenCalled();
  });

  it('still calls the RPC for page-only listing intents (no unsafe segment)', async () => {
    const rpcImpl = rpcImplResolving(makeRow({ total_count: 12 }));
    const result = await resolveStorefrontBlogListingStatus({
      origin: 'https://ogabassey.com',
      identifier: 'page-only.example',
      intent: { kind: 'listing-page', page: 2 },
      secret: 'internal-secret',
      rpcImpl,
    });

    // total_count 12 → 1 page; page 2 clamps to page 1 (`/blog`).
    expect(result).toEqual({
      kind: 'redirect',
      redirectPath: '/blog',
      status: 307,
    });
    expect(rpcImpl).toHaveBeenCalledWith(
      'get_storefront_blog_listing_status',
      { p_identifier: 'page-only.example', p_author_name: '' },
      expect.any(AbortSignal)
    );
  });

  it('fails open without calling the RPC when the internal secret is missing', async () => {
    const rpcImpl = vi.fn();
    const result = await resolveStorefrontBlogListingStatus({
      origin: 'https://ogabassey.com',
      identifier: 'no-secret.example',
      intent: { kind: 'listing-page', page: 99 },
      secret: undefined,
      rpcImpl: rpcImpl as unknown as StorefrontPreflightRpcImpl,
    });

    expect(result).toEqual({ kind: 'noop' });
    expect(rpcImpl).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'no-secret' })
    );
  });

  it('is a NOOP without calling the RPC for an author URL with no profile', async () => {
    const rpcImpl = vi.fn();
    const result = await resolveStorefrontBlogListingStatus({
      // A non-ogabassey tenant owns no author profiles.
      origin: 'https://other-store.example',
      identifier: 'other-store.example',
      intent: { kind: 'author', authorSlug: 'bassey-john', page: 1 },
      secret: 'internal-secret',
      rpcImpl: rpcImpl as unknown as StorefrontPreflightRpcImpl,
    });

    expect(result).toEqual({ kind: 'noop' });
    expect(rpcImpl).not.toHaveBeenCalled();
  });

  it('passes the resolved canonical author name to the RPC and clamps out-of-range author pages', async () => {
    const rpcImpl = rpcImplResolving(
      makeRow({ author_count: 287, categories: [], category_counts: [] })
    );
    const result = await resolveStorefrontBlogListingStatus({
      origin: 'https://ogabassey.com',
      identifier: OGABASSEY,
      intent: { kind: 'author', authorSlug: 'Bassey-John', page: 999 },
      secret: 'internal-secret',
      rpcImpl,
    });

    expect(result).toEqual({
      kind: 'redirect',
      redirectPath: '/blog/author/bassey-john?page=24',
      status: 307,
    });
    expect(rpcImpl).toHaveBeenCalledWith(
      'get_storefront_blog_listing_status',
      { p_identifier: OGABASSEY, p_author_name: 'Bassey John' },
      expect.any(AbortSignal)
    );
  });

  it('returns notFound for a known author with zero published posts', async () => {
    const rpcImpl = rpcImplResolving(
      makeRow({ author_count: 0, categories: [], category_counts: [] })
    );
    const result = await resolveStorefrontBlogListingStatus({
      origin: 'https://ogabassey.com',
      identifier: OGABASSEY,
      intent: { kind: 'author', authorSlug: 'bassey-john', page: 1 },
      secret: 'internal-secret',
      rpcImpl,
    });

    expect(result).toEqual({ kind: 'notFound' });
  });

  it('308-redirects a known ?category= to the clean category route', async () => {
    const rpcImpl = rpcImplResolving(makeRow());
    const result = await resolveStorefrontBlogListingStatus({
      origin: 'https://ogabassey.com',
      identifier: 'category-query.example',
      intent: { kind: 'category-query', category: 'Smartphones' },
      secret: 'internal-secret',
      rpcImpl,
    });

    expect(result).toEqual({
      kind: 'redirect',
      redirectPath: '/blog/category/smartphones',
      status: 308,
    });
  });

  it('308-redirects ?category=News to /blog/category/tech-news for Ogabassey', async () => {
    const rpcImpl = rpcImplResolving(
      makeRow({ categories: ['Tech News'], category_counts: [5] })
    );
    const result = await resolveStorefrontBlogListingStatus({
      origin: 'https://ogabassey.com',
      identifier: OGABASSEY,
      intent: { kind: 'category-query', category: 'News' },
      secret: 'internal-secret',
      rpcImpl,
    });

    expect(result).toEqual({
      kind: 'redirect',
      redirectPath: '/blog/category/tech-news',
      status: 308,
    });
  });

  it('308-redirects ?category=Review to /blog/category/reviews for Ogabassey', async () => {
    const rpcImpl = rpcImplResolving(
      makeRow({ categories: ['Reviews'], category_counts: [5] })
    );
    const result = await resolveStorefrontBlogListingStatus({
      origin: 'https://ogabassey.com',
      identifier: 'ogabassey',
      intent: { kind: 'category-query', category: 'Review' },
      secret: 'internal-secret',
      rpcImpl,
    });

    expect(result).toEqual({
      kind: 'redirect',
      redirectPath: '/blog/category/reviews',
      status: 308,
    });
  });

  it('307-clamps an out-of-range listing page to the last page', async () => {
    const rpcImpl = rpcImplResolving(makeRow());
    const result = await resolveStorefrontBlogListingStatus({
      origin: 'https://ogabassey.com',
      identifier: 'listing-clamp.example',
      intent: { kind: 'listing-page', page: 999 },
      secret: 'internal-secret',
      rpcImpl,
    });

    // total_count 515 → 43 pages.
    expect(result).toEqual({
      kind: 'redirect',
      redirectPath: '/blog?page=43',
      status: 307,
    });
  });

  it.each([
    'unknown',
    'unpublished',
  ])('fails open and skips for a %s storefront status', async (storefront_status) => {
    const rpcImpl = rpcImplResolving(makeRow({ storefront_status }));
    const result = await resolveStorefrontBlogListingStatus({
      origin: 'https://ogabassey.com',
      identifier: `status-${storefront_status}.example`,
      intent: { kind: 'listing-page', page: 99 },
      secret: 'internal-secret',
      rpcImpl,
    });

    expect(result).toEqual({ kind: 'noop' });
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] skip',
      expect.objectContaining({ reason: 'unknown-storefront' })
    );
  });

  it('fails open to NOOP when the RPC row fails schema validation', async () => {
    // A string count is what a mixed-deploy shape drift would send; the row must
    // fail zod parsing and degrade to NOOP rather than compose a bad clamp.
    const rpcImpl = rpcImplResolving({ ...makeRow(), total_count: '515' });
    const result = await resolveStorefrontBlogListingStatus({
      origin: 'https://ogabassey.com',
      identifier: 'schema-fail.example',
      intent: { kind: 'listing-page', page: 99 },
      secret: 'internal-secret',
      rpcImpl,
    });

    expect(result).toEqual({ kind: 'noop' });
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'parse' })
    );
  });

  it('fails open to NOOP when the RPC transport rejects', async () => {
    const rpcImpl = vi.fn().mockRejectedValue(new Error('network unreachable'));
    const result = await resolveStorefrontBlogListingStatus({
      origin: 'https://ogabassey.com',
      identifier: 'transport-error.example',
      intent: { kind: 'listing-page', page: 99 },
      secret: 'internal-secret',
      rpcImpl: rpcImpl as unknown as StorefrontPreflightRpcImpl,
    });

    expect(result).toEqual({ kind: 'noop' });
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'fetch-error' })
    );
  });
});
