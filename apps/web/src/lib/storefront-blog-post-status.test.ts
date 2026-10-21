import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveStorefrontBlogPostStatus } from './storefront-blog-post-status';
import {
  resetStorefrontPreflightRpcForTests,
  type StorefrontPreflightRpcImpl,
  type StorefrontPreflightRpcResult,
} from './storefront-preflight-rpc';

interface BlogPostStatusRowOverrides {
  storefront_status?: string;
  blog_enabled?: unknown;
  live_present?: unknown;
  redirect_target_slug?: unknown;
}

function makeRow(overrides: BlogPostStatusRowOverrides = {}) {
  return {
    storefront_status: 'published',
    blog_enabled: true,
    live_present: true,
    redirect_target_slug: null,
    ...overrides,
  };
}

function rpcImplResolving(row: unknown): StorefrontPreflightRpcImpl {
  return vi.fn(
    async (): Promise<StorefrontPreflightRpcResult> => ({
      data: [row],
      error: null,
    })
  );
}

function overEncodedSlug(): string {
  let slug = 'my blog post';
  for (let i = 0; i < 10; i++) {
    slug = encodeURIComponent(slug);
  }
  return slug;
}

describe('resolveStorefrontBlogPostStatus', () => {
  beforeEach(() => {
    resetStorefrontPreflightRpcForTests();
    // VERCEL_ENV is normally unset in vitest, which passes the transport's
    // preview gate by default; delete defensively in case another suite left
    // it stubbed.
    delete process.env.VERCEL_ENV;
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('fails open and skips the RPC for unsafe (over-encoded) slugs without calling rpcImpl', async () => {
    const rpcImpl = vi.fn();
    const slug = overEncodedSlug();

    const result = await resolveStorefrontBlogPostStatus({
      origin: 'https://ogabassey.com',
      identifier: 'unsafe-slug.example',
      postSlug: slug,
      secret: 'internal-secret',
      rpcImpl: rpcImpl as unknown as StorefrontPreflightRpcImpl,
    });

    expect(result).toEqual({ kind: 'present-or-unknown' });
    expect(rpcImpl).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(
      '[storefront-internal-preflight] skip',
      expect.objectContaining({
        surface: 'blog-post-status',
        reason: 'over-encoded',
      })
    );
  });

  it('fails open without calling rpcImpl when the internal secret is missing', async () => {
    const rpcImpl = vi.fn();

    const result = await resolveStorefrontBlogPostStatus({
      origin: 'https://ogabassey.com',
      identifier: 'no-secret.example',
      postSlug: 'some-post',
      secret: undefined,
      rpcImpl: rpcImpl as unknown as StorefrontPreflightRpcImpl,
    });

    expect(result).toEqual({ kind: 'present-or-unknown' });
    expect(rpcImpl).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'no-secret' })
    );
  });

  it('fails open when the RPC transport rejects', async () => {
    const rpcImpl = vi.fn().mockRejectedValue(new Error('network unreachable'));

    const result = await resolveStorefrontBlogPostStatus({
      origin: 'https://ogabassey.com',
      identifier: 'transport-error.example',
      postSlug: 'some-post',
      secret: 'internal-secret',
      rpcImpl: rpcImpl as unknown as StorefrontPreflightRpcImpl,
    });

    expect(result).toEqual({ kind: 'present-or-unknown' });
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'fetch-error' })
    );
  });

  it('fails open when the RPC row fails schema validation', async () => {
    const consoleInfoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const rpcImpl = rpcImplResolving(
      makeRow({ blog_enabled: 'false' as unknown as boolean })
    );

    const result = await resolveStorefrontBlogPostStatus({
      origin: 'https://ogabassey.com',
      identifier: 'schema-fail.example',
      postSlug: 'some-post',
      secret: 'internal-secret',
      rpcImpl,
    });

    expect(result).toEqual({ kind: 'present-or-unknown' });
    // The caller-side parse fail-open carries the producing attempt's ID,
    // so it correlates with the transport's attempt record.
    const [, attemptProperties] = consoleInfoSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({
        reason: 'parse',
        attemptId: attemptProperties.attempt_id,
      })
    );
  });

  it.each([
    'unknown',
    'unpublished',
  ])('fails open and skips for a %s storefront status', async (storefront_status) => {
    const rpcImpl = rpcImplResolving(makeRow({ storefront_status }));

    const result = await resolveStorefrontBlogPostStatus({
      origin: 'https://ogabassey.com',
      identifier: `storefront-status-${storefront_status}.example`,
      postSlug: 'some-post',
      secret: 'internal-secret',
      rpcImpl,
    });

    expect(result).toEqual({ kind: 'present-or-unknown' });
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] skip',
      expect.objectContaining({ reason: 'unknown-storefront' })
    );
  });

  it('returns missing when the blog feature is disabled on a published storefront', async () => {
    const rpcImpl = rpcImplResolving(
      makeRow({ blog_enabled: false, live_present: false })
    );

    const result = await resolveStorefrontBlogPostStatus({
      origin: 'https://ogabassey.com',
      identifier: 'blog-disabled.example',
      postSlug: 'some-post',
      secret: 'internal-secret',
      rpcImpl,
    });

    expect(result).toEqual({ kind: 'missing' });
  });

  it('returns present-or-unknown when the post is live', async () => {
    const rpcImpl = rpcImplResolving(makeRow({ live_present: true }));

    const result = await resolveStorefrontBlogPostStatus({
      origin: 'https://ogabassey.com',
      identifier: 'live-post.example',
      postSlug: 'some-post',
      secret: 'internal-secret',
      rpcImpl,
    });

    expect(result).toEqual({ kind: 'present-or-unknown' });
    expect(rpcImpl).toHaveBeenCalledWith(
      'get_storefront_blog_post_status',
      { p_identifier: 'live-post.example', p_post_slug: 'some-post' },
      expect.any(AbortSignal)
    );
  });

  it('returns a redirect to the current slug when the post has moved', async () => {
    const rpcImpl = rpcImplResolving(
      makeRow({ live_present: false, redirect_target_slug: 'new-slug' })
    );

    const result = await resolveStorefrontBlogPostStatus({
      origin: 'https://ogabassey.com',
      identifier: 'retired-post.example',
      postSlug: 'old-slug',
      secret: 'internal-secret',
      rpcImpl,
    });

    expect(result).toEqual({
      kind: 'redirect',
      redirectPath: '/blog/new-slug',
    });
  });

  it('returns missing when the redirect target is the requested slug itself (case/whitespace insensitive)', async () => {
    const rpcImpl = rpcImplResolving(
      makeRow({ live_present: false, redirect_target_slug: 'old-post' })
    );

    const result = await resolveStorefrontBlogPostStatus({
      origin: 'https://ogabassey.com',
      identifier: 'self-redirect.example',
      postSlug: 'Old-Post',
      secret: 'internal-secret',
      rpcImpl,
    });

    expect(result).toEqual({ kind: 'missing' });
  });

  it.each([
    '',
    '   ',
  ])('returns missing when the redirect target slug is %j', async (redirect_target_slug) => {
    const rpcImpl = rpcImplResolving(
      makeRow({ live_present: false, redirect_target_slug })
    );

    const result = await resolveStorefrontBlogPostStatus({
      origin: 'https://ogabassey.com',
      identifier: `blank-redirect-${redirect_target_slug.length}.example`,
      postSlug: 'some-post',
      secret: 'internal-secret',
      rpcImpl,
    });

    expect(result).toEqual({ kind: 'missing' });
  });

  it('fails open when the redirect target fails safe-internal-redirect-path validation', async () => {
    const rpcImpl = rpcImplResolving(
      makeRow({ live_present: false, redirect_target_slug: 'foo:bar' })
    );

    const result = await resolveStorefrontBlogPostStatus({
      origin: 'https://ogabassey.com',
      identifier: 'unsafe-redirect-target.example',
      postSlug: 'some-post',
      secret: 'internal-secret',
      rpcImpl,
    });

    expect(result).toEqual({ kind: 'present-or-unknown' });
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'has-error' })
    );
  });

  it('returns missing when there is no live post and no redirect target', async () => {
    const rpcImpl = rpcImplResolving(
      makeRow({ live_present: false, redirect_target_slug: null })
    );

    const result = await resolveStorefrontBlogPostStatus({
      origin: 'https://ogabassey.com',
      identifier: 'dangling-post.example',
      postSlug: 'some-post',
      secret: 'internal-secret',
      rpcImpl,
    });

    expect(result).toEqual({ kind: 'missing' });
  });
});
