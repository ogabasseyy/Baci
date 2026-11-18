import { describe, expect, it, vi } from 'vitest';
import { buildCreateBlogPostInsertData } from './build-create-blog-post-insert-data';

describe('buildCreateBlogPostInsertData', () => {
  const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  const basePost = {
    author_name: 'Jane Doe',
    content: 'This is a detailed guide to mobile hardware accessories.',
    slug: 'mobile-hardware-guide',
    title: 'Mobile Hardware Accessories Guide',
  };

  it('persists published_at and requested_publish_at for scheduled posts', () => {
    const scheduledAt = '2026-11-20T10:00:00.000Z';
    const result = buildCreateBlogPostInsertData(merchantId, {
      ...basePost,
      published_at: scheduledAt,
      status: 'scheduled',
    });

    expect(result).toMatchObject({
      merchant_id: merchantId,
      published_at: scheduledAt,
      requested_publish_at: scheduledAt,
      status: 'scheduled',
    });
  });

  it('sets published_at and clears requested_publish_at for published posts', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T12:00:00.000Z'));

    try {
      const result = buildCreateBlogPostInsertData(merchantId, {
        ...basePost,
        published_at: '2026-11-20T10:00:00.000Z',
        status: 'published',
      });

      expect(result.published_at).toBe('2026-11-15T12:00:00.000Z');
      expect(result.requested_publish_at).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('derives default SEO, excerpt, keywords, and metrics for drafts', () => {
    const result = buildCreateBlogPostInsertData(merchantId, {
      ...basePost,
      status: 'draft',
    });

    expect(result).toMatchObject({
      excerpt: expect.any(String),
      focus_keyword: expect.any(String),
      keywords: expect.any(Array),
      published_at: null,
      requested_publish_at: null,
      seo_description: expect.any(String),
      seo_title: basePost.title,
      status: 'draft',
    });
    expect(result.word_count).toBeGreaterThan(0);
    expect(result.reading_time_minutes).toBeGreaterThan(0);
  });
});
