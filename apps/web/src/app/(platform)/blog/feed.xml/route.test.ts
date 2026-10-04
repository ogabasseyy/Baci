import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFeedAddItem = vi.fn();
const mockFeedConstructor = vi.fn();
const mockGetPlatformBlogFeedPosts = vi.fn();

vi.mock('feed', () => ({
  Feed: class MockFeed {
    constructor(options: unknown) {
      mockFeedConstructor(options);
    }

    addItem(item: unknown) {
      mockFeedAddItem(item);
    }

    rss2() {
      return JSON.stringify({
        items: mockFeedAddItem.mock.calls.map((call) => call[0]),
        options: mockFeedConstructor.mock.calls.at(-1)?.[0],
      });
    }
  },
}));

vi.mock('@/lib/platform-blog', () => ({
  PLATFORM_BLOG_CONTEXT: {
    baseUrl: 'https://usebaci.com',
    businessName: 'Baci',
    logoUrl: 'https://usebaci.com/logo.png',
  },
  getPlatformBlogFeedPosts: (...args: unknown[]) =>
    mockGetPlatformBlogFeedPosts(...args),
}));

const { GET } = await import('./route');

describe('GET /blog/feed.xml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlatformBlogFeedPosts.mockResolvedValue([
      {
        author_name: 'Baci Editorial',
        category: 'Guides',
        content: '<p>Content</p>',
        excerpt: 'Excerpt',
        featured_image_url: 'https://usebaci.com/media/platform/blog/post.png',
        id: 'post-1',
        published_at: '2026-05-16T09:00:00.000Z',
        slug: 'launch-faster',
        title: 'Launch Faster',
        updated_at: '2026-05-16T10:00:00.000Z',
      },
    ]);
  });

  it('returns an rss feed with platform context headers', async () => {
    const response = await GET(
      new NextRequest('http://localhost/blog/feed.xml')
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'application/rss+xml; charset=utf-8'
    );
    expect(response.headers.get('cache-control')).toContain('s-maxage=3600');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(mockGetPlatformBlogFeedPosts).toHaveBeenCalled();
    expect(mockFeedAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Launch Faster',
      })
    );
  });

  it('strips XML-forbidden control characters from platform feed fields', async () => {
    mockGetPlatformBlogFeedPosts.mockResolvedValueOnce([
      {
        author_name: 'Editor\u0000 Name',
        category: 'Phones\u001a',
        content: '<p>Content\u000b</p>',
        excerpt: 'Price\u000c update',
        featured_image_url: 'https://usebaci.com/image\u0008.png',
        id: 'post-1',
        published_at: '2026-05-16T09:00:00.000Z',
        slug: 'launch\u001a-faster',
        title: 'Launch\u001a Faster',
        updated_at: null,
      },
    ]);

    const response = await GET(
      new NextRequest('http://localhost/blog/feed.xml')
    );

    expect(response.status).toBe(200);
    expect(mockFeedAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        author: [
          {
            name: 'Editor Name',
            link: 'https://usebaci.com',
          },
        ],
        category: [{ name: 'Phones' }],
        content: '<p>Content</p>',
        description: 'Price update',
        image: 'https://usebaci.com/image.png',
        link: 'https://usebaci.com/blog/launch-faster',
        title: 'Launch Faster',
      })
    );
  });

  it('skips malformed dates instead of failing feed generation', async () => {
    mockGetPlatformBlogFeedPosts.mockResolvedValueOnce([
      {
        author_name: 'Baci Editorial',
        category: null,
        content: '<p>Bad date</p>',
        excerpt: 'Bad date',
        featured_image_url: null,
        id: 'post-1',
        published_at: 'not-a-date',
        slug: 'bad-date',
        title: 'Bad Date',
        updated_at: null,
      },
      {
        author_name: 'Baci Editorial',
        category: null,
        content: '<p>Good date</p>',
        excerpt: 'Good date',
        featured_image_url: null,
        id: 'post-2',
        published_at: '2026-05-16T09:00:00.000Z',
        slug: 'good-date',
        title: 'Good Date',
        updated_at: null,
      },
    ]);

    const response = await GET(
      new NextRequest('http://localhost/blog/feed.xml')
    );

    expect(response.status).toBe(200);
    expect(mockFeedAddItem).toHaveBeenCalledTimes(1);
    expect(mockFeedAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Good Date',
      })
    );
  });

  it('returns 500 when feed posts fail to load', async () => {
    mockGetPlatformBlogFeedPosts.mockRejectedValueOnce(new Error('boom'));

    const response = await GET(
      new NextRequest('http://localhost/blog/feed.xml')
    );

    expect(response.status).toBe(500);
  });
});
