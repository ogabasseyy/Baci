import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBlogClassificationRead,
  mockBlogPostBodyFallback,
  mockDraftMode,
  mockHeaders,
  mockNotFound,
  mockGetRequestScopedBlogPost,
  mockGetLiveBlogPost,
  mockGetBlogPostRedirect,
  mockBuildInformationalClusterModel,
  mockGenerateBlogPostSchema,
  mockSafeJsonLdStringify,
  mockBlogPostHeader,
  mockBlogPostBody,
  mockHasBlogAuthorPage,
} = vi.hoisted(() => ({
  mockBlogClassificationRead: vi.fn(),
  mockBlogPostBodyFallback: vi.fn((_props: unknown) => null as ReactNode),
  mockDraftMode: vi.fn(),
  mockHeaders: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  mockGetRequestScopedBlogPost: vi.fn(),
  mockGetLiveBlogPost: vi.fn(),
  mockGetBlogPostRedirect: vi.fn(),
  mockBuildInformationalClusterModel: vi.fn(),
  mockGenerateBlogPostSchema: vi.fn<(data: unknown) => Record<string, unknown>>(
    () => ({})
  ),
  mockSafeJsonLdStringify: vi.fn<(_schema: unknown) => string>((schema) =>
    JSON.stringify(schema)
  ),
  mockBlogPostHeader: vi.fn(({ title }: { title: string; locale?: string }) => (
    <h1>{title}</h1>
  )),
  mockBlogPostBody: vi.fn((_props?: unknown) => null),
  mockHasBlogAuthorPage: vi.fn(
    (_authorName?: unknown, _tenant?: unknown) => true
  ),
}));

vi.mock('lucide-react', () => ({
  AlertTriangle: () => null,
  ArrowLeft: () => null,
}));

vi.mock('next/headers', () => ({
  draftMode: () => mockDraftMode(),
  headers: () => mockHeaders(),
}));

vi.mock('next/image', () => ({
  default: () => null,
  getImageProps: ({
    fill: _fill,
    loader: _loader,
    preload: _preload,
    priority: _priority,
    quality: _quality,
    ...props
  }: Record<string, unknown>) => ({ props }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
  permanentRedirect: (url: string) => {
    throw new Error(`NEXT_PERMANENT_REDIRECT:${url}`);
  },
}));

vi.mock(
  '@/components/storefront/ogabassey/seo/informational-cluster-panel',
  () => ({
    InformationalClusterPanel: () => null,
  })
);

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedBlogPost: (...args: unknown[]) =>
    mockGetRequestScopedBlogPost(...args),
}));

vi.mock('@/lib/live-blog-post', () => ({
  getLiveBlogPost: (...args: unknown[]) => mockGetLiveBlogPost(...args),
}));

vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => ({
    rpc: () => ({
      abortSignal: () => ({ retry: () => mockBlogClassificationRead() }),
    }),
  }),
}));

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));

vi.mock('@/lib/blog-post-redirects', () => ({
  getBlogPostRedirect: (...args: unknown[]) => mockGetBlogPostRedirect(...args),
}));

vi.mock('@/lib/routes', () => ({
  asRoute: (value: string) => value,
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: (schema: unknown) => mockSafeJsonLdStringify(schema),
  sanitizeSchemaUrl: (url: string) =>
    url.startsWith('http://') || url.startsWith('https://') ? url : '',
}));

vi.mock('@/lib/seo-utils', () => ({
  generateBlogPostSchema: (data: unknown) => mockGenerateBlogPostSchema(data),
  generateBreadcrumbSchema: () => ({}),
  generateSlug: (value: string) =>
    value
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]+/g, '')
      .replace(/--+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, ''),
}));

vi.mock('@/lib/blog-organization-schema', () => ({
  buildBlogOrganizationSchema: () => ({
    '@id': 'https://ogabassey.com#organization',
    '@type': 'OnlineStore',
  }),
}));

vi.mock('@/lib/blog-authors', () => ({
  getBlogAuthorSameAs: () => ['https://www.linkedin.com/in/michael-bolakale'],
  hasBlogAuthorPage: (...args: unknown[]) => mockHasBlogAuthorPage(...args),
}));

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: (merchant: { slug: string; custom_domain?: string }) =>
    merchant.custom_domain
      ? `https://${merchant.custom_domain}`
      : `https://${merchant.slug}.usebaci.com`,
}));

vi.mock('@/lib/storefront-content/build-informational-cluster-model', () => ({
  buildInformationalClusterModel: (...args: unknown[]) =>
    mockBuildInformationalClusterModel(...args),
}));

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: (value: string) => value.includes('.'),
}));

vi.mock('./BlogPostBody', () => ({
  BlogPostBody: (props: unknown) => mockBlogPostBody(props),
}));

vi.mock('./BlogPostBodyFallback', () => ({
  BlogPostBodyFallback: (props: unknown) => mockBlogPostBodyFallback(props),
}));

vi.mock('./BlogPostHeader', () => ({
  BlogPostHeader: (props: { title: string; locale?: string }) =>
    mockBlogPostHeader(props),
}));

vi.mock('./blog-post-content', () => ({
  buildCanonicalBlogPostUrl: (
    merchant: { slug: string; custom_domain?: string },
    postSlug: string
  ) =>
    merchant.custom_domain
      ? `https://${merchant.custom_domain}/blog/${postSlug}`
      : `https://${merchant.slug}.usebaci.com/blog/${postSlug}`,
  getBlogPostTextPreview: () => 'Preview text',
}));

vi.mock('./view-counter', () => ({
  ViewCounter: () => null,
}));

import BlogPostPageContent from './blog-post-page-content';

const smartphoneGuideBlogPost = {
  merchant: {
    id: 'merchant-1',
    business_name: 'Ogabassey',
    slug: 'ogabassey',
    logo_url: null,
    custom_domain: 'ogabassey.com',
    social_media: {},
  },
  post: {
    id: 'post-1',
    title: 'Best Phones in Nigeria for 2026',
    slug: 'best-phones-in-nigeria',
    content: '<p>Test</p>',
    excerpt: 'Affordable Android and iPhone picks for buyers in Nigeria.',
    featured_image_url:
      'https://cdn.ogabassey.com/media/blog/best-phones-cover.webp',
    featured_image_alt: 'Best phones in Nigeria cover',
    featured_image_variants: {},
    category: 'Smartphones',
    tags: ['budget', 'iphone', 'samsung'],
    author_name: 'Bolakale',
    author_title: null,
    author_bio: null,
    author_image_url:
      'https://cdn.ogabassey.com/merchants/ogabassey/authors/bolakale.jpg',
    published_at: '2026-03-16T10:05:33.654Z',
    updated_at: '2026-03-16T10:05:33.654Z',
    classification_revision: '11111111-1111-4111-8111-111111111111',
    seo_title: null,
    seo_description: null,
    keywords: ['android', 'battery', 'smartphones'],
    reading_time_minutes: 4,
    word_count: 800,
  },
  relatedPosts: [],
  relatedProducts: [],
};

describe('BlogPostPageContent hero LCP image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBlogClassificationRead.mockResolvedValue({ data: [], error: null });
    mockDraftMode.mockResolvedValue({ isEnabled: false });
    mockHeaders.mockResolvedValue(
      new Headers({
        'accept-language': 'en-us,en;q=0.8',
      })
    );
    mockGetRequestScopedBlogPost.mockResolvedValue(smartphoneGuideBlogPost);
    mockGetLiveBlogPost.mockResolvedValue(null);
    mockGetBlogPostRedirect.mockResolvedValue(null);
    mockBuildInformationalClusterModel.mockResolvedValue(null);
  });

  it('renders the featured article hero as a preload-only LCP image with fetchpriority="high"', async () => {
    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    const image = screen.getByRole('img', {
      name: 'Best phones in Nigeria cover',
    });

    expect(image).toHaveAttribute(
      'src',
      'https://cdn.ogabassey.com/media/blog/best-phones-cover.webp'
    );
    // Repo LCP convention: preload sets fetchpriority="high" on the rendered
    // hero <img> while omitting redundant priority/loading attributes.
    expect(image).not.toHaveAttribute('priority');
    expect(image).toHaveAttribute('fetchpriority', 'high');
    expect(image).not.toHaveAttribute('loading');
  });
});
