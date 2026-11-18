import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAuthenticateApiRequest,
  mockCheckCsrfProtection,
  mockGetMerchantBlogRevalidationContext,
  mockHasPermission,
  mockResolveSelectedMerchantAccess,
  mockRevalidateBlogPosts,
} = vi.hoisted(() => ({
  mockAuthenticateApiRequest: vi.fn(),
  mockCheckCsrfProtection: vi.fn(),
  mockGetMerchantBlogRevalidationContext: vi.fn(),
  mockHasPermission: vi.fn(),
  mockResolveSelectedMerchantAccess: vi.fn(),
  mockRevalidateBlogPosts: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mockAuthenticateApiRequest,
  hasPermission: mockHasPermission,
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mockCheckCsrfProtection,
}));

vi.mock('@/app/api/merchant/features/resolve-selected-merchant-access', () => ({
  resolveSelectedMerchantAccess: mockResolveSelectedMerchantAccess,
}));

vi.mock('@/lib/get-merchant-blog-cache-identifiers', () => ({
  getMerchantBlogRevalidationContext: mockGetMerchantBlogRevalidationContext,
}));

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateBlogPosts: mockRevalidateBlogPosts,
}));

import { DELETE, POST } from './route';

describe('/api/merchant/blog/posts/[id]/release-reservation', () => {
  const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  const postId = 'd3000000-0000-4000-8000-000000000001';
  const articleIdentity = 'e1000000-0000-4000-8000-000000000001';
  const mockRpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateApiRequest.mockResolvedValue({
      error: null,
      supabase: { rpc: mockRpc },
      user: { id: 'user-1' },
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
    mockResolveSelectedMerchantAccess.mockResolvedValue({
      access: { merchantId },
      invalidMerchantId: false,
    });
    mockHasPermission.mockReturnValue(true);
    mockGetMerchantBlogRevalidationContext.mockResolvedValue({
      canonicalMerchantSlug: 'ogabassey',
      identifiers: ['ogabassey'],
    });
  });

  const makeContext = (id = postId) => ({
    params: Promise.resolve({ id }),
  });

  it('reserves a release slot and returns 201', async () => {
    mockRpc.mockResolvedValue({
      data: {
        idempotent_replay: false,
        post_status: 'scheduled',
        reservation_id: 'res-1',
        state: 'reserved',
      },
      error: null,
    });

    const request = new NextRequest(
      `http://localhost/api/merchant/blog/posts/${postId}/release-reservation`,
      {
        body: JSON.stringify({
          article_identity: articleIdentity,
          release_class: 'evergreen',
          request_id: 'req-1',
          requested_publish_at: '2026-11-20T10:00:00.000Z',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }
    );

    const response = await POST(request, makeContext());
    expect(response.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith(
      'reserve_merchant_blog_release_v1',
      expect.objectContaining({
        p_article_identity: articleIdentity,
        p_merchant_id: merchantId,
        p_payload_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_post_id: postId,
        p_release_class: 'evergreen',
        p_request_id: 'req-1',
      })
    );
    expect(mockRevalidateBlogPosts).toHaveBeenCalledOnce();
  });

  it('maps capacity/policy conflicts from reserve RPC to 409', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'daily_cap_exceeded' },
    });

    const request = new NextRequest(
      `http://localhost/api/merchant/blog/posts/${postId}/release-reservation`,
      {
        body: JSON.stringify({
          article_identity: articleIdentity,
          release_class: 'evergreen',
          request_id: 'req-cap',
          requested_publish_at: '2026-11-20T10:00:00.000Z',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }
    );

    const response = await POST(request, makeContext());
    expect(response.status).toBe(409);
  });

  it('cancels an active reservation via DELETE without Content-Length and revalidates cache', async () => {
    mockRpc.mockResolvedValue({
      data: { cancelled: true, post_status: 'draft', state: 'cancelled' },
      error: null,
    });

    const request = new NextRequest(
      `http://localhost/api/merchant/blog/posts/${postId}/release-reservation`,
      {
        body: JSON.stringify({ reason: 'editorial_hold' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'DELETE',
      }
    );

    const response = await DELETE(request, makeContext());
    expect(response?.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('cancel_merchant_blog_release_v1', {
      p_merchant_id: merchantId,
      p_post_id: postId,
      p_reason: 'editorial_hold',
    });
    expect(mockRevalidateBlogPosts).toHaveBeenCalledOnce();
  });

  it('returns 401 when unauthenticated on POST and DELETE', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });

    const postRes = await POST(
      new NextRequest(
        `http://localhost/api/merchant/blog/posts/${postId}/release-reservation`,
        { body: '{}', method: 'POST' }
      ),
      makeContext()
    );
    const delRes = await DELETE(
      new NextRequest(
        `http://localhost/api/merchant/blog/posts/${postId}/release-reservation`,
        { method: 'DELETE' }
      ),
      makeContext()
    );

    expect(postRes?.status).toBe(401);
    expect(delRes?.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid post ID or malformed JSON and 500 on unmapped RPC failure', async () => {
    const invalidIdRes = await POST(
      new NextRequest(
        'http://localhost/api/merchant/blog/posts/bad-id/release-reservation',
        { body: '{}', method: 'POST' }
      ),
      makeContext('bad-id')
    );
    expect(invalidIdRes?.status).toBe(400);

    const badJsonDelRes = await DELETE(
      new NextRequest(
        `http://localhost/api/merchant/blog/posts/${postId}/release-reservation`,
        { body: '{not-json', method: 'DELETE' }
      ),
      makeContext()
    );
    expect(badJsonDelRes?.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();

    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'XX000', message: 'unexpected db failure' },
    });
    const rpcErrRes = await POST(
      new NextRequest(
        `http://localhost/api/merchant/blog/posts/${postId}/release-reservation`,
        {
          body: JSON.stringify({
            article_identity: articleIdentity,
            release_class: 'evergreen',
            request_id: 'req-500',
            requested_publish_at: '2026-11-20T10:00:00.000Z',
          }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        }
      ),
      makeContext()
    );
    expect(rpcErrRes?.status).toBe(500);
  });

  it('returns 403 when user lacks marketing edit permission', async () => {
    mockHasPermission.mockReturnValue(false);

    const request = new NextRequest(
      `http://localhost/api/merchant/blog/posts/${postId}/release-reservation`,
      { method: 'DELETE' }
    );

    const response = await DELETE(request, makeContext());
    expect(response.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
