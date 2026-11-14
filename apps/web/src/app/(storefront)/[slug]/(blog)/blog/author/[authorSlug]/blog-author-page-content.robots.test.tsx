import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCachedBlogAuthor } = vi.hoisted(() => ({
  mockGetCachedBlogAuthor: vi.fn(),
}));

vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // biome-ignore lint/performance/noImgElement: test stub for next/image
    <img src={src} alt={alt} />
  ),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  permanentRedirect: (url: string) => {
    throw new Error(`NEXT_PERMANENT_REDIRECT:${url}`);
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedBlogAuthor: (...args: unknown[]) => mockGetCachedBlogAuthor(...args),
}));

vi.mock('@/lib/routes', () => ({ asRoute: (value: string) => value }));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: (value: unknown) => JSON.stringify(value),
  sanitizeSchemaUrl: (value: string) => value,
}));

vi.mock('@/lib/seo-utils', () => ({
  generateBreadcrumbSchema: () => ({ '@type': 'BreadcrumbList' }),
}));

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: () => 'https://ogabassey.com',
}));

import { BlogAuthorPageContent } from './blog-author-page-content';

const authorData = {
  merchant: {
    id: 'm1',
    business_name: 'Ogabassey',
    slug: 'ogabassey',
    logo_url: null,
    custom_domain: 'ogabassey.com',
  },
  author: {
    name: 'Bassey John',
    title: 'Performance Marketing Specialist',
    bio: 'Bassey John writes practical buying guides.',
    imageUrl: null,
  },
  posts: [
    {
      id: 'p1',
      title: 'Best Phones in Nigeria',
      slug: 'best-phones',
      excerpt: 'Budget and flagship picks.',
      featured_image_url: null,
      featured_image_alt: null,
      category: 'Smartphones',
      published_at: '2026-03-16T10:00:00.000Z',
      reading_time_minutes: 4,
    },
  ],
  totalPosts: 24,
  currentPage: 1,
  totalPages: 3,
};

describe('BlogAuthorPageContent robots meta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('omits robots meta tag on page 1 and emits noindex, follow on paginated pages', async () => {
    mockGetCachedBlogAuthor.mockResolvedValueOnce({
      ...authorData,
      currentPage: 1,
      totalPages: 3,
    });
    const page1 = render(
      await BlogAuthorPageContent({
        params: Promise.resolve({
          slug: 'ogabassey.com',
          authorSlug: 'bassey-john',
        }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
    page1.unmount();

    mockGetCachedBlogAuthor.mockResolvedValueOnce({
      ...authorData,
      currentPage: 2,
      totalPages: 3,
    });
    const page2 = render(
      await BlogAuthorPageContent({
        params: Promise.resolve({
          slug: 'ogabassey.com',
          authorSlug: 'bassey-john',
        }),
        searchParams: Promise.resolve({ page: '2' }),
      })
    );
    expect(mockGetCachedBlogAuthor).toHaveBeenCalledWith(
      'ogabassey.com',
      'Bassey John',
      { page: 2 }
    );
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, follow'
    );
    page2.unmount();
  });
});
