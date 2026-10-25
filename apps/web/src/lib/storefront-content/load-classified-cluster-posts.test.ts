import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBlogClusterCollections } from './build-blog-cluster-collections';
import { inferContentClusterContext } from './infer-content-cluster-context';
import { loadClassifiedClusterPosts } from './load-classified-cluster-posts';

const { rpc, retry, abortSignal, createPublicClient } = vi.hoisted(() => ({
  rpc: vi.fn(),
  retry: vi.fn(),
  abortSignal: vi.fn(),
  createPublicClient: vi.fn(),
}));
vi.mock('@/lib/supabase/public', () => ({ createPublicClient }));
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));

const post = {
  id: '1e4fe058-a2ce-4f14-b633-a80d14bfaeb2',
  slug: 'iphone-ownership',
  title: 'Apple iPhone ownership',
  excerpt: 'Useful information for owners.',
  category: 'Smartphones',
  featured_image_url: null,
  published_at: '2026-10-25T10:00:00Z',
  reading_time_minutes: 5,
  updated_at: '2026-10-25T10:00:00.000Z',
  classification_revision: '11111111-1111-4111-8111-111111111111',
};
const classification = {
  post_id: post.id,
  intent: 'buying-guide',
  source: 'reviewed',
  classifier_version: 'v1',
  classified_at: '2026-10-25T10:00:00Z',
  post_updated_at: '2026-10-25T11:00:00+01:00',
  post_revision: '11111111-1111-4111-8111-111111111111',
};

function respond(data: unknown, error: unknown = null) {
  retry.mockResolvedValue({ data, error });
  abortSignal.mockReturnValue({ retry });
  rpc.mockReturnValue({ abortSignal });
}

describe('loadClassifiedClusterPosts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPublicClient.mockReturnValue({ rpc });
    respond([classification]);
  });

  it('canonicalizes lookup IDs without changing article order or duplicate cards', async () => {
    const secondPost = {
      ...post,
      id: '2e4fe058-a2ce-4f14-b633-a80d14bfaeb2',
      slug: 'iphone-comparison',
    };
    respond([
      classification,
      { ...classification, post_id: secondPost.id, intent: 'comparison' },
    ]);
    const input = [secondPost, post, secondPost];
    const reversed = await loadClassifiedClusterPosts('merchant-1', input);
    const forward = await loadClassifiedClusterPosts('merchant-1', [
      post,
      secondPost,
    ]);

    const lookup = {
      p_merchant_id: 'merchant-1',
      p_post_ids: [post.id, secondPost.id],
    };
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'get_storefront_blog_classifications_v1',
      lookup
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'get_storefront_blog_classifications_v1',
      lookup
    );
    expect(reversed.map((item) => [item.slug, item.merchant_intent])).toEqual([
      ['iphone-comparison', 'comparison'],
      ['iphone-ownership', 'buying-guide'],
      ['iphone-comparison', 'comparison'],
    ]);
    expect(forward.map((item) => item.slug)).toEqual([
      'iphone-ownership',
      'iphone-comparison',
    ]);
    expect(input.map((item) => item.id)).toEqual([
      secondPost.id,
      post.id,
      secondPost.id,
    ]);
  });

  it('uses safe current classifications to make metadata-poor guides discoverable', async () => {
    const secondPost = {
      ...post,
      id: '2e4fe058-a2ce-4f14-b633-a80d14bfaeb2',
      slug: 'iphone-setup',
    };
    respond([classification, { ...classification, post_id: secondPost.id }]);
    const posts = await loadClassifiedClusterPosts('merchant-1', [
      post,
      secondPost,
    ]);
    const collections = buildBlogClusterCollections({
      storeUrl: 'https://ogabassey.com',
      posts,
    });
    expect(collections[0]?.guides[0]).toMatchObject({
      href: 'https://ogabassey.com/blog/iphone-ownership',
      kind: 'buyer-guide',
    });
    expect(posts[0]).toMatchObject({
      merchant_intent: 'buying-guide',
      merchant_intent_source: 'reviewed',
      tags: null,
      keywords: null,
    });
    expect(rpc).toHaveBeenCalledWith('get_storefront_blog_classifications_v1', {
      p_merchant_id: 'merchant-1',
      p_post_ids: [post.id, secondPost.id],
    });
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(retry).toHaveBeenCalledWith(false);
  });

  it('keeps news out of guide collections despite matching headline keywords', async () => {
    respond([{ ...classification, intent: 'news' }]);
    const posts = await loadClassifiedClusterPosts('merchant-1', [
      { ...post, title: 'Apple launches a new iPhone buying guide' },
    ]);
    expect(inferContentClusterContext(posts[0]).kind).toBeNull();
    expect(
      buildBlogClusterCollections({ storeUrl: 'https://ogabassey.com', posts })
    ).toEqual([]);
  });

  it.each([
    { post_revision: '22222222-2222-4222-8222-222222222222' },
    { post_revision: 'invalid' },
    { post_id: 'another-post' },
    { intent: 'platform' },
    { source: 'untrusted' },
  ])('does not attach stale, foreign or malformed metadata: %j', async (override) => {
    respond([{ ...classification, ...override }]);
    const [result] = await loadClassifiedClusterPosts('merchant-1', [
      { ...post, title: 'Apple iPhone buying guide' },
    ]);
    expect(result.merchant_intent).toBeUndefined();
    expect(inferContentClusterContext(result).kind).toBe('buyer-guide');
  });

  it('keeps classification current when only updated_at changed after a view-counter write', async () => {
    const postAfterViewCountUpdate = {
      ...post,
      updated_at: '2026-10-25T11:00:00Z',
    };
    const [result] = await loadClassifiedClusterPosts('merchant-1', [
      postAfterViewCountUpdate,
    ]);

    expect(result.merchant_intent).toBe('buying-guide');
  });

  it('keeps heuristic classification when the database suppresses a stale record', async () => {
    respond([]);
    const [result] = await loadClassifiedClusterPosts('merchant-1', [
      { ...post, title: 'Apple iPhone buying guide' },
    ]);
    expect(result.merchant_intent).toBeUndefined();
    expect(inferContentClusterContext(result).kind).toBe('buyer-guide');
  });

  it('degrades on a read error and can recover on the next request', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    respond(null, { code: '57014', message: 'private diagnostic' });
    const first = await loadClassifiedClusterPosts('merchant-1', [post]);
    expect(first[0].merchant_intent).toBeUndefined();
    respond([classification]);
    const second = await loadClassifiedClusterPosts('merchant-1', [post]);
    expect(second[0].merchant_intent).toBe('buying-guide');
    expect(JSON.stringify(warning.mock.calls)).not.toContain(
      'private diagnostic'
    );
    warning.mockRestore();
  });

  it('does not fetch classifications for an empty listing', async () => {
    expect(await loadClassifiedClusterPosts('merchant-1', [])).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not query metadata when the stable article revision is missing', async () => {
    const [result] = await loadClassifiedClusterPosts('merchant-1', [
      { ...post, classification_revision: undefined },
    ]);
    expect(result.title).toBe(post.title);
    expect(result.merchant_intent).toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects an oversized batch without silently dropping article cards', async () => {
    const posts = Array.from({ length: 201 }, (_, index) => ({
      ...post,
      id: `post-${index}`,
    }));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadClassifiedClusterPosts('merchant-1', posts)).toHaveLength(
      201
    );
    expect(rpc).not.toHaveBeenCalled();
    warning.mockRestore();
  });
});
