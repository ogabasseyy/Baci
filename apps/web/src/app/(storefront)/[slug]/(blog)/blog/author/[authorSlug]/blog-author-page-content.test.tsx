import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetBlogAuthorBySlug,
  mockGetCachedBlogAuthor,
  mockHeaders,
  mockNotFound,
  mockPermanentRedirect,
  mockRedirect,
  mockResolveBlogCatchAllOutcome,
} = vi.hoisted(() => ({
  mockGetBlogAuthorBySlug: vi.fn(),
  mockGetCachedBlogAuthor: vi.fn(),
  mockHeaders: vi.fn(() => {
    throw new Error('author page must not read request headers');
  }),
  mockResolveBlogCatchAllOutcome: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  mockPermanentRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_PERMANENT_REDIRECT:${url}`);
  }),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
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
  notFound: () => mockNotFound(),
  permanentRedirect: (url: string) => mockPermanentRedirect(url),
  redirect: (url: string) => mockRedirect(url),
}));

vi.mock(
  '@/app/(storefront)/[slug]/(blog)/blog/[...catchAll]/blog-catch-all-resolution',
  () => ({
    resolveBlogCatchAllOutcome: (...args: unknown[]) =>
      mockResolveBlogCatchAllOutcome(...args),
  })
);

vi.mock('@/lib/blog-authors', () => ({
  getBlogAuthorBySlug: (...args: unknown[]) => mockGetBlogAuthorBySlug(...args),
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
  buildStoreUrl: (merchant: { custom_domain?: string; slug: string }) =>
    merchant.custom_domain
      ? `https://${merchant.custom_domain}`
      : `https://${merchant.slug}.usebaci.com`,
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
    bio: 'Bassey John is a Performance Marketing Specialist at Ogabassey.',
    imageUrl:
      'https://cdn.ogabassey.com/merchants/ogabassey/authors/bassey-john.jpg',
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
  totalPosts: 1,
  currentPage: 1,
  totalPages: 1,
};

describe('BlogAuthorPageContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockImplementation(() => {
      throw new Error('author page must not read request headers');
    });
    mockGetBlogAuthorBySlug.mockReturnValue({
      name: 'Bassey John',
      sameAs: [
        'https://www.linkedin.com/in/bassey-john-6a277885',
        'https://twitter.com/digitalogaa',
      ],
    });
    mockGetCachedBlogAuthor.mockResolvedValue(authorData);
    mockResolveBlogCatchAllOutcome.mockResolvedValue({ type: 'notFound' });
  });

  it('renders the author profile, social links, posts, and a ProfilePage/Person graph', async () => {
    const { container } = render(
      await BlogAuthorPageContent({
        params: Promise.resolve({
          slug: 'ogabassey.com',
          authorSlug: 'bassey-john',
        }),
      })
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Bassey John' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Performance Marketing Specialist at Ogabassey')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Bassey John is a Performance Marketing Specialist/)
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'LinkedIn' })).toHaveAttribute(
      'href',
      'https://www.linkedin.com/in/bassey-john-6a277885'
    );
    expect(screen.getByRole('link', { name: 'X' })).toHaveAttribute(
      'href',
      'https://twitter.com/digitalogaa'
    );
    expect(
      screen.getByRole('link', { name: /Best Phones in Nigeria/ })
    ).toHaveAttribute('href', '../best-phones');

    const scripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    const profileScript = Array.from(scripts).find((s) =>
      s.textContent?.includes('ProfilePage')
    );
    expect(profileScript?.textContent).toContain(
      '"@id":"https://ogabassey.com#author-bassey-john"'
    );
    expect(profileScript?.textContent).toContain(
      '"jobTitle":"Performance Marketing Specialist"'
    );
  });

  it('normalizes mixed-case author slugs for canonical Person ids', async () => {
    const { container } = render(
      await BlogAuthorPageContent({
        params: Promise.resolve({
          slug: 'OgaBassey.com',
          authorSlug: 'Bassey-John',
        }),
      })
    );

    expect(mockGetBlogAuthorBySlug).toHaveBeenCalledWith(
      'bassey-john',
      'OgaBassey.com'
    );
    const profileScript = Array.from(
      container.querySelectorAll('script[type="application/ld+json"]')
    ).find((s) => s.textContent?.includes('ProfilePage'));
    expect(profileScript?.textContent).toContain(
      '"@id":"https://ogabassey.com#author-bassey-john"'
    );
    expect(profileScript?.textContent).toContain(
      '"url":"https://ogabassey.com/blog/author/bassey-john"'
    );
  });

  it('uses origin-preserving relative navigation without request headers', async () => {
    render(
      await BlogAuthorPageContent({
        params: Promise.resolve({
          slug: 'ogabassey.com',
          authorSlug: 'bassey-john',
        }),
      })
    );

    expect(screen.getByRole('link', { name: /Back to Blog/ })).toHaveAttribute(
      'href',
      '..'
    );
    expect(mockHeaders).not.toHaveBeenCalled();
  });

  it('redirects legacy author-prefixed post URLs before falling through to 404', async () => {
    mockGetBlogAuthorBySlug.mockReturnValue(null);
    mockResolveBlogCatchAllOutcome.mockResolvedValue({
      type: 'redirect',
      status: 308,
      url: 'https://ogabassey.com/blog/legacy-post',
    });

    await expect(
      BlogAuthorPageContent({
        params: Promise.resolve({
          slug: 'ogabassey.com',
          authorSlug: 'legacy-post',
        }),
      })
    ).rejects.toThrow(
      'NEXT_PERMANENT_REDIRECT:https://ogabassey.com/blog/legacy-post'
    );

    expect(mockResolveBlogCatchAllOutcome).toHaveBeenCalledWith({
      params: expect.any(Promise),
    });
    expect(mockPermanentRedirect).toHaveBeenCalledWith(
      'https://ogabassey.com/blog/legacy-post'
    );
    expect(mockGetCachedBlogAuthor).not.toHaveBeenCalled();
  });

  it('calls notFound for an unknown author slug after legacy redirect fallback misses', async () => {
    mockGetBlogAuthorBySlug.mockReturnValue(null);

    await expect(
      BlogAuthorPageContent({
        params: Promise.resolve({
          slug: 'ogabassey.com',
          authorSlug: 'nobody',
        }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockResolveBlogCatchAllOutcome).toHaveBeenCalledWith({
      params: expect.any(Promise),
    });
    expect(mockGetCachedBlogAuthor).not.toHaveBeenCalled();
  });

  it('redirects stale paginated author URLs to the last available page', async () => {
    mockGetCachedBlogAuthor.mockResolvedValueOnce({
      ...authorData,
      currentPage: 5,
      totalPages: 2,
    });

    await expect(
      BlogAuthorPageContent({
        params: Promise.resolve({
          slug: 'ogabassey.com',
          authorSlug: 'bassey-john',
        }),
        searchParams: Promise.resolve({ page: '5' }),
      })
    ).rejects.toThrow('NEXT_REDIRECT:./bassey-john?page=2');

    expect(mockRedirect).toHaveBeenCalledWith('./bassey-john?page=2');
  });

  it('calls notFound when the author has no published posts', async () => {
    mockGetCachedBlogAuthor.mockResolvedValue(null);

    await expect(
      BlogAuthorPageContent({
        params: Promise.resolve({
          slug: 'ogabassey.com',
          authorSlug: 'bassey-john',
        }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
