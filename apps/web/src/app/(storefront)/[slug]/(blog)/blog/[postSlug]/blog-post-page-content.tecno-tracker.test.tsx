import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBlogClassificationRead,
  mockDraftMode,
  mockHeaders,
  mockGetRequestScopedBlogPost,
} = vi.hoisted(() => ({
  mockBlogClassificationRead: vi.fn(),
  mockDraftMode: vi.fn(),
  mockHeaders: vi.fn(),
  mockGetRequestScopedBlogPost: vi.fn(),
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
vi.mock('@/lib/routes', () => ({ asRoute: (value: string) => value }));
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
  buildStoreUrl: (merchant: { custom_domain?: string; slug: string }) =>
    merchant.custom_domain
      ? `https://${merchant.custom_domain}`
      : `https://${merchant.slug}.usebaci.com`,
}));
vi.mock('@/lib/storefront-content/build-informational-cluster-model', () => ({
  buildInformationalClusterModel: async () => null,
}));
vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: (value: string) => value.includes('.'),
}));
vi.mock('./BlogPostBody', () => ({ BlogPostBody: () => null }));
vi.mock('./BlogPostBodyFallback', () => ({ BlogPostBodyFallback: () => null }));
vi.mock('./BlogPostHeader', () => ({ BlogPostHeader: () => null }));
vi.mock('./blog-post-content', () => ({
  buildCanonicalBlogPostUrl: (
    merchant: { custom_domain?: string; slug: string },
    postSlug: string
  ) =>
    `${
      merchant.custom_domain
        ? `https://${merchant.custom_domain}`
        : `https://${merchant.slug}.usebaci.com`
    }/blog/${postSlug}`,
  getBlogPostTextPreview: () => 'Preview',
}));
vi.mock('./tecno-blog-click-tracker', () => ({
  TecnoBlogClickTracker: () => <div data-testid="tecno-blog-click-tracker" />,
}));
vi.mock('./view-counter', () => ({ ViewCounter: () => null }));

import BlogPostPageContent from './blog-post-page-content';

describe('BlogPostPageContent TECNO click tracker gate', () => {
  const sponsoredSlug = 'tecno-camon-slim-iphone-instant-transfer-sponsored';

  beforeEach(() => {
    vi.clearAllMocks();
    mockDraftMode.mockResolvedValue({ isEnabled: false });
    mockHeaders.mockResolvedValue(new Headers([['x-locale', 'en-US']]));
    mockBlogClassificationRead.mockResolvedValue({ data: [], error: null });
  });

  async function renderPost(options: {
    customDomain?: string;
    postSlug: string;
    draft?: boolean;
  }) {
    mockDraftMode.mockResolvedValue({ isEnabled: Boolean(options.draft) });
    mockGetRequestScopedBlogPost.mockResolvedValue({
      merchant: {
        id: 'merchant-1',
        business_name: 'Ogabassey',
        slug: 'ogabassey',
        custom_domain: options.customDomain,
      },
      post: {
        id: 'post-1',
        title: 'Sponsored Post',
        slug: options.postSlug,
        content: '<p>Test</p>',
        category: 'Smartphones',
      },
      relatedPosts: [],
      relatedProducts: [],
    });

    render(
      await BlogPostPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          postSlug: options.postSlug,
        }),
      })
    );
  }

  it('mounts the tracker on the live canonical custom-domain sponsored post', async () => {
    await renderPost({
      customDomain: 'ogabassey.com',
      postSlug: sponsoredSlug,
    });
    expect(screen.getByTestId('tecno-blog-click-tracker')).toBeInTheDocument();
  });

  it('does not mount on draft mode, subdomain host, or another slug', async () => {
    await renderPost({
      customDomain: 'ogabassey.com',
      postSlug: sponsoredSlug,
      draft: true,
    });
    await renderPost({
      postSlug: sponsoredSlug,
    });
    await renderPost({
      customDomain: 'ogabassey.com',
      postSlug: 'other-article',
    });
    expect(screen.queryByTestId('tecno-blog-click-tracker')).toBeNull();
  });
});
