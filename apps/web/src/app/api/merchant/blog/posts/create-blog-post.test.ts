import { describe, expect, it } from 'vitest';
import {
  mockPostCreationSelectSequence,
  registerPostTestSetup,
  validPostData,
} from './post.test-support';
import {
  makeRequest,
  mockAuthenticateApiRequest,
  mockGetMerchantForApiRequest,
  mockSupabase,
} from './route.test-support';

const { createBlogPost } = await import('./create-blog-post');

registerPostTestSetup();

describe('createBlogPost', () => {
  it('stops an unauthenticated mutation before it can create a merchant post', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });

    const response = await createBlogPost(
      makeRequest('/api/merchant/blog/posts', { body: validPostData })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('rejects invalid data before resolving merchant access or loading settings', async () => {
    const { title: _, ...invalidPostData } = validPostData;

    const response = await createBlogPost(
      makeRequest('/api/merchant/blog/posts', { body: invalidPostData })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Validation error',
    });
    expect(mockGetMerchantForApiRequest).not.toHaveBeenCalled();
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('uses the merchant business name when the author is omitted', async () => {
    const { author_name: _, ...postWithoutAuthor } = validPostData;

    const response = await createBlogPost(
      makeRequest('/api/merchant/blog/posts', { body: postWithoutAuthor })
    );

    expect(response.status).toBe(201);
    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({ author_name: 'Test Store' })
    );
  });

  it('rejects an overlong merchant-derived author name when the author is omitted', async () => {
    const { author_name: _, ...postWithoutAuthor } = validPostData;
    mockPostCreationSelectSequence({
      merchant: {
        data: { business_name: 'A'.repeat(101), slug: 'test-store' },
        error: null,
      },
    });

    const response = await createBlogPost(
      makeRequest('/api/merchant/blog/posts', { body: postWithoutAuthor })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Validation error',
    });
    expect(mockSupabase.insert).not.toHaveBeenCalled();
  });

  it('preserves an explicit author when the merchant business name is overlong', async () => {
    mockPostCreationSelectSequence({
      merchant: {
        data: { business_name: 'A'.repeat(101), slug: 'test-store' },
        error: null,
      },
    });

    const response = await createBlogPost(
      makeRequest('/api/merchant/blog/posts', { body: validPostData })
    );

    expect(response.status).toBe(201);
    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({ author_name: 'John Doe' })
    );
  });

  it('creates an authenticated merchant draft through the atomic post mutation', async () => {
    const response = await createBlogPost(
      makeRequest('/api/merchant/blog/posts', { body: validPostData })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: '1',
      merchant_id: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      slug: 'new-blog-post',
    });
    expect(mockSupabase.rpc).toHaveBeenCalledOnce();
  });

  it('persists published_at when creating a scheduled post', async () => {
    const scheduledAt = '2026-11-16T10:00:00.000Z';
    const response = await createBlogPost(
      makeRequest('/api/merchant/blog/posts', {
        body: {
          ...validPostData,
          published_at: scheduledAt,
          status: 'scheduled',
        },
      })
    );

    expect(response.status).toBe(201);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'mutate_merchant_blog_post_with_product_links',
      expect.objectContaining({
        p_post_data: expect.objectContaining({
          published_at: scheduledAt,
          status: 'scheduled',
        }),
      })
    );
  });
});
