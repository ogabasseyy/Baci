import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBlogClassificationRead,
  mockDraftMode,
  mockHeaders,
  mockGetRequestScopedBlogPost,
  mockBuildInformationalClusterModel,
  mockBlogPostBody,
} = vi.hoisted(() => ({
  mockBlogClassificationRead: vi.fn(),
  mockDraftMode: vi.fn(),
  mockHeaders: vi.fn(),
  mockGetRequestScopedBlogPost: vi.fn(),
  mockBuildInformationalClusterModel: vi.fn(),
  mockBlogPostBody: vi.fn((_props?: unknown) => null),
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
  getImageProps: (props: Record<string, unknown>) => ({ props }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
  permanentRedirect: vi.fn(),
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
  getLiveBlogPost: vi.fn(),
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
  getBlogPostRedirect: vi.fn(),
}));
vi.mock('@/lib/routes', () => ({
  asRoute: (value: string) => value,
}));
vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: (schema: unknown) => JSON.stringify(schema),
  sanitizeSchemaUrl: (url: string) => url,
}));
vi.mock('@/lib/seo-utils', () => ({
  generateBlogPostSchema: () => ({}),
  generateBreadcrumbSchema: () => ({}),
  generateSlug: (value: string) => value.toLowerCase(),
}));
vi.mock('@/lib/blog-organization-schema', () => ({
  buildBlogOrganizationSchema: () => ({}),
}));
vi.mock('@/lib/blog-authors', () => ({
  getBlogAuthorSameAs: () => [],
  hasBlogAuthorPage: () => false,
}));
vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: () => 'https://ogabassey.com',
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
  BlogPostBodyFallback: () => null,
}));
vi.mock('./BlogPostHeader', () => ({
  BlogPostHeader: () => null,
}));
vi.mock('./blog-post-content', () => ({
  buildCanonicalBlogPostUrl: () =>
    'https://ogabassey.com/blog/best-phones-in-nigeria',
  getBlogPostTextPreview: () => 'Preview',
}));
vi.mock('./view-counter', () => ({
  ViewCounter: () => null,
}));

import BlogPostPageContent from './blog-post-page-content';

describe('BlogPostPageContent related product exclusion wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDraftMode.mockResolvedValue({ isEnabled: false });
    mockHeaders.mockResolvedValue(new Headers([['x-locale', 'en-US']]));
    mockBlogClassificationRead.mockResolvedValue({ data: [], error: null });
    mockBuildInformationalClusterModel.mockResolvedValue(null);
  });

  it.each([
    false,
    true,
  ])('excludes only the normalized first 8 card products from cluster featured picks (heroHoisted=%s)', async (heroHoisted) => {
    const relatedProducts = [
      { id: 'invalid', name: 'Missing Slug', slug: '   ' },
      ...Array.from({ length: 10 }, (_, idx) => ({
        id: `prod-${idx + 1}`,
        name: `  Phone ${idx + 1}  `,
        slug: `  phone-${idx + 1}  `,
        category_slug: 'smartphones',
      })),
    ];

    mockGetRequestScopedBlogPost.mockResolvedValue({
      merchant: {
        id: 'merchant-1',
        business_name: 'Ogabassey',
        slug: 'ogabassey',
        custom_domain: 'ogabassey.com',
      },
      post: {
        id: 'post-1',
        title: 'Best Phones in Nigeria',
        slug: 'best-phones-in-nigeria',
        content: '<p>Test</p>',
        category: 'Smartphones',
      },
      relatedPosts: [],
      relatedProducts,
    });

    render(
      await BlogPostPageContent({
        heroHoisted,
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: 'best-phones-in-nigeria',
        }),
      })
    );

    expect(mockBlogPostBody).toHaveBeenCalledWith(
      expect.objectContaining({
        relatedProducts,
      })
    );
    expect(mockBuildInformationalClusterModel).toHaveBeenCalledWith(
      expect.objectContaining({
        excludedProductSlugs: new Set([
          'phone-1',
          'phone-2',
          'phone-3',
          'phone-4',
          'phone-5',
          'phone-6',
          'phone-7',
          'phone-8',
        ]),
      })
    );
  });
});
