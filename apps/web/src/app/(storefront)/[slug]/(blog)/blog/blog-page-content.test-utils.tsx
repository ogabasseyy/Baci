import type React from 'react';
import { vi } from 'vitest';
import { getCachedBlogListing } from '@/lib/cached-data';
import { buildListingResult } from './blog-page-content.test-utils.fixtures';
import type {
  MockDefaultBlogUiProps,
  MockTemplateBlogRendererProps,
} from './blog-page-content.test-utils.types';

const hoistedMocks = vi.hoisted(() => ({
  mockBuildBlogClusterCollections: vi.fn(),
  mockDefaultBlogUi: vi.fn((props: MockDefaultBlogUiProps) => (
    <>
      {props.itemListSchema ? (
        <script type="application/ld+json">
          {JSON.stringify(props.itemListSchema)}
        </script>
      ) : null}
      {props.categoryGuide}
      <div>{props.merchant.business_name} blog</div>
    </>
  )),
  mockGetTemplate: vi.fn<(...args: unknown[]) => unknown>(() => null),
  mockHeaders: vi.fn(() => new Headers()),
  mockPreloadBlogListingFeaturedImage: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  mockPermanentRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_PERMANENT_REDIRECT:${url}`);
  }),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  mockTemplateBlogRenderer: vi.fn((_props: MockTemplateBlogRendererProps) => (
    <div>Template blog</div>
  )),
}));

export const {
  mockBuildBlogClusterCollections,
  mockDefaultBlogUi,
  mockGetTemplate,
  mockHeaders,
  mockNotFound,
  mockPermanentRedirect,
  mockPreloadBlogListingFeaturedImage,
  mockRedirect,
  mockTemplateBlogRenderer,
} = hoistedMocks;

export {
  buildListingResult,
  clusterCollections,
  merchant,
  postsPayload,
} from './blog-page-content.test-utils.fixtures';
export type {
  MockDefaultBlogUiProps,
  MockTemplateBlogRendererProps,
} from './blog-page-content.test-utils.types';

vi.mock('@/lib/cached-data', () => ({
  getCachedBlogListing: vi.fn(),
}));

vi.mock('./blog-category-hub', () => ({
  resolveBlogCategoryHub: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: async () => mockHeaders(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
  permanentRedirect: (url: string) => mockPermanentRedirect(url),
  redirect: (url: string) => mockRedirect(url),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/routes', () => ({
  asRoute: (value: string) => value,
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: vi.fn(() => '{}'),
}));

vi.mock('@/lib/seo-utils', () => ({
  generateBreadcrumbSchema: vi.fn(() => ({})),
  generateMetaDescription: vi.fn((description: string) => description),
  generateMetaTitle: vi.fn(
    (
      title: string,
      options?: { fallback?: string; maxLength?: number; suffix?: string }
    ) => {
      const baseTitle = title || options?.fallback || '';
      const fullTitle = options?.suffix
        ? `${baseTitle} | ${options.suffix}`
        : baseTitle;
      const maxLength = options?.maxLength ?? 70;

      if (fullTitle.length <= maxLength) {
        return fullTitle;
      }

      if (!options?.suffix) {
        return `${baseTitle.slice(0, maxLength - 3).trim()}...`;
      }

      const suffix = ` | ${options.suffix}`;
      const maxBaseLength = maxLength - suffix.length - 3;
      if (maxBaseLength <= 0) {
        return `${baseTitle.slice(0, maxLength - 3).trim()}...`;
      }
      return `${baseTitle.slice(0, maxBaseLength).trim()}...${suffix}`;
    }
  ),
  generateSlug: (value: string) => value.toLowerCase().replace(/\s+/g, '-'),
}));

vi.mock('@/lib/blog-organization-schema', () => ({
  buildBlogOrganizationSchema: vi.fn(() => ({
    '@id': 'https://test-store.usebaci.com#organization',
    '@type': 'OnlineStore',
  })),
}));

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: (merchant: {
    slug: string;
    custom_domain?: string | null;
    store_url?: string;
  }) =>
    merchant.store_url
      ? merchant.store_url
      : merchant.custom_domain
        ? `https://${merchant.custom_domain}`
        : `https://${merchant.slug}.usebaci.com`,
}));

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: (value: string) => value.includes('.'),
}));

vi.mock('@/lib/storefront-content/build-blog-cluster-collections', () => ({
  buildBlogClusterCollections: (...args: unknown[]) =>
    mockBuildBlogClusterCollections(...args),
}));

vi.mock('@/templates/registry', () => ({
  getTemplate: (templateId: unknown) => mockGetTemplate(templateId),
}));

vi.mock('./blog-listing-featured-image-preload', () => ({
  preloadBlogListingFeaturedImage: (src: string | null | undefined) =>
    mockPreloadBlogListingFeaturedImage(src),
}));

vi.mock('./default-blog-ui', () => ({
  DefaultBlogUi: (props: MockDefaultBlogUiProps) => mockDefaultBlogUi(props),
}));

vi.mock('./template-blog-renderer', () => ({
  TemplateBlogRenderer: (props: MockTemplateBlogRendererProps) =>
    mockTemplateBlogRenderer(props),
}));

vi.mock('./blog-listing-pagination', () => ({
  BlogListingPagination: (props: {
    storeBasePath: string;
    category?: string;
    currentPage: number;
    search?: string;
    totalPages: number;
  }) => (
    <nav
      aria-label="Blog pagination"
      data-testid="blog-pagination"
      data-store-base-path={props.storeBasePath}
      data-category={props.category}
      data-current-page={props.currentPage}
      data-search={props.search}
      data-total-pages={props.totalPages}
    />
  ),
}));

export const mockGetCachedBlogListing = vi.mocked(getCachedBlogListing);
export const mockResolveBlogCategoryHub = vi.mocked(
  (await import('./blog-category-hub')).resolveBlogCategoryHub
);

export function resetBlogPageContentMocks() {
  mockGetCachedBlogListing.mockReset();
  mockGetCachedBlogListing.mockResolvedValue(buildListingResult());
  mockPreloadBlogListingFeaturedImage.mockClear();
  mockResolveBlogCategoryHub.mockReset();
  mockNotFound.mockClear();
  mockPermanentRedirect.mockClear();
  mockRedirect.mockClear();
  mockHeaders.mockReset();
  mockHeaders.mockReturnValue(new Headers());
  mockBuildBlogClusterCollections.mockReset();
  mockBuildBlogClusterCollections.mockReturnValue([]);
  mockDefaultBlogUi.mockReset();
  mockDefaultBlogUi.mockImplementation((props: MockDefaultBlogUiProps) => (
    <>
      {props.itemListSchema ? (
        <script type="application/ld+json">
          {JSON.stringify(props.itemListSchema)}
        </script>
      ) : null}
      {props.categoryGuide}
      <div>{props.merchant.business_name} blog</div>
    </>
  ));
  mockGetTemplate.mockReset();
  mockGetTemplate.mockReturnValue(null);
  mockTemplateBlogRenderer.mockReset();
  mockTemplateBlogRenderer.mockImplementation(
    (_props: MockTemplateBlogRendererProps) => <div>Template blog</div>
  );
}
