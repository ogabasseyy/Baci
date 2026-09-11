import type { ComponentType, ReactNode } from 'react';
import { InformationalClusterIndex } from '@/components/storefront/ogabassey/seo/informational-cluster-index';
import type { JsonLdScriptData } from '@/lib/json-ld-types';
import { generateSlug } from '@/lib/seo-utils';
import type { BlogClusterCollection } from '@/lib/storefront-content/content-cluster-types';
import type { BlogPostData, TemplateBlogPageProps } from '@/templates/registry';
import { getTemplate } from '@/templates/registry';
import { BlogDiscoverySection } from './blog-discovery-section';
import { BlogListingPagination } from './blog-listing-pagination';
import { TemplateBlogRenderer } from './template-blog-renderer';

type TemplateListingPost = {
  author_name: string | null;
  category: string | null;
  excerpt: string | null;
  featured_image_url: string | null;
  id: string;
  published_at: string;
  reading_time_minutes: number | null;
  slug: string;
  title: string;
};

export async function BlogListingTemplatePage({
  authorLinks,
  basePath,
  blogSchema,
  breadcrumbSchema,
  category,
  categoryGuide,
  committedSnapshotMarker,
  currentPage,
  effectiveSearchQuery,
  guideCollections,
  hasItemListSchemaSearch,
  hideLiveFeatured,
  itemListSchema,
  merchantName,
  organizationSchema,
  paginationHeadLinks,
  posts,
  publicCategories,
  storeUrl,
  templateId,
  totalPages,
}: {
  authorLinks: { name: string; slug: string }[];
  basePath: string;
  blogSchema: JsonLdScriptData;
  breadcrumbSchema: JsonLdScriptData;
  category?: string;
  categoryGuide?: ReactNode;
  committedSnapshotMarker: ReactNode;
  currentPage: number;
  effectiveSearchQuery?: string;
  guideCollections: BlogClusterCollection[];
  hasItemListSchemaSearch: boolean;
  hideLiveFeatured: boolean;
  itemListSchema?: JsonLdScriptData;
  merchantName: string;
  organizationSchema: JsonLdScriptData;
  paginationHeadLinks: ReactNode;
  posts: TemplateListingPost[];
  publicCategories: string[];
  storeUrl: string;
  templateId: string;
  totalPages: number;
}): Promise<ReactNode | null> {
  if (templateId === 'default' || templateId === 'puck') {
    return null;
  }

  const template = getTemplate(templateId);
  if (!template) {
    return null;
  }

  let templateBlogUi: {
    BlogComponent: ComponentType<TemplateBlogPageProps>;
    categories: { name: string; slug: string }[];
    posts: BlogPostData[];
  } | null = null;
  try {
    const components = await template.getComponents();
    if (components.Blog) {
      templateBlogUi = {
        BlogComponent: components.Blog,
        categories: publicCategories.map((cat) => ({
          name: cat,
          slug: generateSlug(cat),
        })),
        posts: posts.map((post) => ({
          id: post.id,
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt || '',
          category: post.category || '',
          author_name: post.author_name || merchantName,
          published_at: post.published_at,
          featured_image_url: post.featured_image_url || '',
          reading_time_minutes: post.reading_time_minutes || 3,
        })),
      };
    }
  } catch (error) {
    console.error(
      'Failed to load Blog component for template',
      templateId,
      ':',
      error
    );
  }

  if (!templateBlogUi) {
    return null;
  }

  return (
    <>
      {committedSnapshotMarker}
      {paginationHeadLinks}
      <TemplateBlogRenderer
        blogSchema={blogSchema}
        breadcrumbSchema={breadcrumbSchema}
        organizationSchema={organizationSchema}
        itemListSchema={hasItemListSchemaSearch ? undefined : itemListSchema}
        BlogComponent={templateBlogUi.BlogComponent}
        basePath={storeUrl}
        blogPosts={templateBlogUi.posts}
        categories={templateBlogUi.categories}
        categoryGuide={categoryGuide}
        category={category}
        searchQuery={effectiveSearchQuery}
        hideFeaturedStory={hideLiveFeatured}
      />
      <BlogListingPagination
        storeBasePath={basePath}
        currentPage={currentPage}
        totalPages={totalPages}
        category={category}
        search={effectiveSearchQuery}
      />
      <InformationalClusterIndex collections={guideCollections} />
      <BlogDiscoverySection
        baseUrl={storeUrl}
        authors={authorLinks}
        categories={publicCategories}
        posts={posts}
      />
    </>
  );
}
