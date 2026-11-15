import { describe, expect, it, vi } from 'vitest';
import { persistBlogPostMutation } from './persist-blog-post-mutation';

const merchantId = 'merchant-1';
const postData = {
  content: '<p>Useful content</p>',
  slug: 'useful-post',
  status: 'draft',
  title: 'Useful post',
};

function createSupabase(input: {
  products?: { data: unknown; error: unknown };
  rpc: { data: unknown; error: unknown };
}) {
  const in_ = vi
    .fn()
    .mockResolvedValue(input.products ?? { data: [], error: null });
  const eq = vi.fn().mockReturnValue({ in: in_ });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const rpc = vi.fn().mockResolvedValue(input.rpc);
  return { rpc, supabase: { from, rpc } };
}

describe('persistBlogPostMutation', () => {
  it('fails before the RPC when an embedded product belongs to another merchant', async () => {
    const { rpc, supabase } = createSupabase({
      products: { data: [], error: null },
      rpc: { data: null, error: null },
    });

    await expect(
      persistBlogPostMutation({
        embeddedProductIds: ['foreign-product'],
        merchantId,
        postData,
        postId: null,
        supabase: supabase as never,
      })
    ).resolves.toMatchObject({
      error: 'One or more embedded products do not belong to this merchant',
      post: null,
      status: 400,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('maps a duplicate merchant slug from the atomic RPC to a conflict response', async () => {
    const { supabase } = createSupabase({
      rpc: {
        data: null,
        error: {
          code: '23505',
          message:
            'duplicate key value violates unique constraint blog_posts_merchant_id_slug_key',
        },
      },
    });

    await expect(
      persistBlogPostMutation({
        embeddedProductIds: undefined,
        merchantId,
        postData,
        postId: null,
        supabase: supabase as never,
      })
    ).resolves.toMatchObject({
      error: 'A post with this slug already exists',
      post: null,
      status: 409,
    });
  });

  it('normalizes the atomic RPC record into the blog post response contract', async () => {
    const { supabase } = createSupabase({
      rpc: {
        data: [{ id: 'post-1', merchant_id: merchantId, ...postData }],
        error: null,
      },
    });

    await expect(
      persistBlogPostMutation({
        embeddedProductIds: undefined,
        merchantId,
        postData,
        postId: null,
        supabase: supabase as never,
      })
    ).resolves.toMatchObject({
      error: null,
      post: { id: 'post-1', merchant_id: merchantId, slug: 'useful-post' },
      status: null,
    });
  });

  it.each([
    ['P0001', 'active_reservation_already_exists', 409],
    ['P0001', 'cannot_reschedule_published_blog_post', 409],
    ['P0001', 'article_identity_conflict', 409],
    ['P0001', 'reservation_request_payload_mismatch', 409],
    ['P0001', 'evergreen_reserve_required', 409],
    ['P0001', 'min_spacing_conflict', 409],
    ['P0001', 'low_demand_game_software_cap_exceeded', 409],
    ['22023', 'fast_track_outside_lagos_window', 400],
  ] as const)('maps %s (%s) to HTTP %d', async (code, message, expectedStatus) => {
    const { supabase } = createSupabase({
      rpc: { data: null, error: { code, message } },
    });

    await expect(
      persistBlogPostMutation({
        embeddedProductIds: undefined,
        merchantId,
        postData,
        postId: 'post-1',
        reschedulePublishAt: '2026-11-16T10:00:00.000Z',
        supabase: supabase as never,
      })
    ).resolves.toMatchObject({
      post: null,
      status: expectedStatus,
    });
  });
});
