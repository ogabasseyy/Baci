import { render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BlogListingTemplatePage } from './blog-listing-template-page';

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/templates/registry', () => ({
  getTemplate: vi.fn((templateId: string) => {
    if (templateId !== 'ogabassey') {
      return undefined;
    }

    return {
      getComponents: async () => ({
        Blog: () => <div>Template blog</div>,
      }),
    };
  }),
}));

vi.mock('./template-blog-renderer', () => ({
  TemplateBlogRenderer: ({
    BlogComponent,
  }: {
    BlogComponent: ComponentType;
  }) => <BlogComponent />,
}));

vi.mock('./blog-listing-pagination', () => ({
  BlogListingPagination: () => null,
}));

vi.mock('./blog-discovery-section', () => ({
  BlogDiscoverySection: () => null,
}));

vi.mock(
  '@/components/storefront/ogabassey/seo/informational-cluster-index',
  () => ({
    InformationalClusterIndex: () => null,
  })
);

describe('BlogListingTemplatePage', () => {
  const props = {
    authorLinks: [],
    basePath: 'https://ogabassey.com',
    blogSchema: { '@context': 'https://schema.org', '@type': 'Blog' },
    breadcrumbSchema: {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
    },
    committedSnapshotMarker: null,
    currentPage: 1,
    guideCollections: [],
    hasItemListSchemaSearch: false,
    hideLiveFeatured: true,
    merchantName: 'Ogabassey',
    organizationSchema: {
      '@context': 'https://schema.org',
      '@type': 'Organization',
    },
    paginationHeadLinks: null,
    posts: [],
    publicCategories: ['News'],
    storeUrl: 'https://ogabassey.com',
    totalPages: 1,
  };

  it('returns null for default and puck templates', async () => {
    expect(
      await BlogListingTemplatePage({ ...props, templateId: 'default' })
    ).toBeNull();
    expect(
      await BlogListingTemplatePage({ ...props, templateId: 'puck' })
    ).toBeNull();
  });

  it('renders the template blog when the merchant template exposes Blog', async () => {
    render(
      await BlogListingTemplatePage({ ...props, templateId: 'ogabassey' })
    );

    expect(screen.getByText('Template blog')).toBeInTheDocument();
  });
});
