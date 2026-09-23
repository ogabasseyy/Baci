import { beforeEach, describe, expect, it } from 'vitest';
import {
  liveBlogPost,
  mockGetRequestScopedBlogPost,
  resetBlogPostPageMocks,
} from './page.test-utils';

async function generateBlogPostMetadata(postSlug: string) {
  const { generateMetadata } = await import('./page');

  return generateMetadata({
    params: Promise.resolve({
      slug: 'ogabassey.com',
      postSlug,
    }),
  });
}

describe('storefront blog post metadata titles', () => {
  beforeEach(() => {
    resetBlogPostPageMocks();
  });

  it('keeps a descriptive long blog post title complete while preserving its single merchant suffix', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue({
      ...liveBlogPost,
      post: {
        ...liveBlogPost.post,
        title:
          'Best Phones Under 500000 Naira in Nigeria With Camera Battery and Gaming Performance Compared',
        excerpt:
          'Compare the best phones under 500000 naira in Nigeria with camera quality, battery life, gaming performance, warranty coverage, delivery options, and flexible payment notes for shoppers.',
      },
    });

    const metadata = await generateBlogPostMetadata('best-phones-under-500000');

    const title = (metadata.title as { absolute: string }).absolute;
    expect(title).toBe(
      'Best Phones Under 500000 Naira in Nigeria With Camera Battery and Gaming Performance Compared | Ogabassey'
    );
    expect(title).not.toContain('...');
    expect(typeof metadata.description).toBe('string');
    if (typeof metadata.description !== 'string') {
      throw new TypeError('metadata.description must be a string');
    }
    expect(metadata.description.length).toBeLessThanOrEqual(160);
  });

  it('sanitizes a blog SEO title and adds the merchant suffix once', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue({
      ...liveBlogPost,
      post: {
        ...liveBlogPost.post,
        seo_title:
          '<script>alert(1)</script> Itel Power 80 Review | Ogabassey | Ogabassey',
      },
    });

    const metadata = await generateBlogPostMetadata('itel-power-80-review');

    expect(metadata.title).toEqual({
      absolute: 'alert(1) Itel Power 80 Review | Ogabassey',
    });
    expect(metadata.openGraph).toEqual(
      expect.objectContaining({
        title: 'alert(1) Itel Power 80 Review | Ogabassey',
      })
    );
  });

  it('falls back safely when blog title values are empty after sanitization', async () => {
    mockGetRequestScopedBlogPost.mockResolvedValue({
      ...liveBlogPost,
      post: {
        ...liveBlogPost.post,
        seo_title: '<span> </span>',
        title: '   ',
      },
    });

    const metadata = await generateBlogPostMetadata('empty-title');

    expect(metadata.title).toEqual({ absolute: 'Blog Post | Ogabassey' });
  });
});
