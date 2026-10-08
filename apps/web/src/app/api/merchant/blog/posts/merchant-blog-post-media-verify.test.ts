import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyMerchantBlogPostMedia } from './merchant-blog-post-media-verify';

function fakeSupabase(
  data: { path: string; status: string }[] | null,
  error: { message: string } | null = null
) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    rpc,
    supabase: { rpc } as unknown as Parameters<
      typeof verifyMerchantBlogPostMedia
    >[0]['supabase'],
  };
}

const KEPT_CONTENT =
  '<img src="https://cdn.example.com/media/platform/blog/kept.webp">';

describe('verifyMerchantBlogPostMedia', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns ok without registering when the save references no media', async () => {
    const { rpc, supabase } = fakeSupabase([]);

    const result = await verifyMerchantBlogPostMedia({
      supabase,
      mediaRow: { content: '<p>No images here</p>' },
    });

    expect(result).toEqual({ kind: 'ok' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns ok when every saved path registers cleared', async () => {
    const { rpc, supabase } = fakeSupabase([
      { path: 'platform/blog/kept.webp', status: 'cleared' },
    ]);

    const result = await verifyMerchantBlogPostMedia({
      supabase,
      mediaRow: { content: KEPT_CONTENT },
    });

    expect(result).toEqual({ kind: 'ok' });
    expect(rpc).toHaveBeenCalledWith('register_blog_media_references_v1', {
      p_paths: ['platform/blog/kept.webp'],
    });
  });

  it('reports lost-media when the sweep claimed a saved path', async () => {
    const { supabase } = fakeSupabase([
      { path: 'platform/blog/kept.webp', status: 'claimed' },
    ]);

    const result = await verifyMerchantBlogPostMedia({
      supabase,
      mediaRow: { content: KEPT_CONTENT },
    });

    expect(result).toEqual({ kind: 'failed', reason: 'lost-media' });
  });

  it('reports lost-media when a saved object is already missing', async () => {
    const { supabase } = fakeSupabase([
      { path: 'platform/blog/kept.webp', status: 'missing' },
    ]);

    const result = await verifyMerchantBlogPostMedia({
      supabase,
      mediaRow: { content: KEPT_CONTENT },
    });

    expect(result).toEqual({ kind: 'failed', reason: 'lost-media' });
  });

  it('reports registration-failed when the register call errors', async () => {
    const { supabase } = fakeSupabase(null, { message: 'down' });

    const result = await verifyMerchantBlogPostMedia({
      supabase,
      mediaRow: { content: KEPT_CONTENT },
    });

    expect(result).toEqual({ kind: 'failed', reason: 'registration-failed' });
  });

  it('reports registration-failed when the register call returns no rows', async () => {
    const { supabase } = fakeSupabase(null);

    const result = await verifyMerchantBlogPostMedia({
      supabase,
      mediaRow: { content: KEPT_CONTENT },
    });

    expect(result).toEqual({ kind: 'failed', reason: 'registration-failed' });
  });

  it('ignores external lookalikes outside the trusted origins', async () => {
    const { rpc, supabase } = fakeSupabase([]);

    const result = await verifyMerchantBlogPostMedia({
      supabase,
      mediaRow: {
        content:
          '<img src="https://example.com/media/platform/blog/example.jpg">',
      },
    });

    expect(result).toEqual({ kind: 'ok' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
