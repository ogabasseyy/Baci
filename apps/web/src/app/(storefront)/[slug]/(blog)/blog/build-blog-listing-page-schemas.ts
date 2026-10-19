import { BLOG_LISTING_PAGE_SIZE } from '@/lib/blog-listing-page-size';
import { getBlogStructuredDataImageUrls } from '@/lib/blog-structured-data-images';
import { generateBreadcrumbSchema } from '@/lib/seo-utils';
import { buildBlogListingSchemaUrl } from './blog-listing-schema-url';

type BlogListingSchemaPost = {
  author_name: string | null;
  excerpt: string | null;
  featured_image_url?: string | null;
  featured_image_variants?: Record<string, unknown> | null;
  featured_image_width?: number | null;
  featured_image_height?: number | null;
  published_at: string;
  slug: string;
  title: string;
};

export function buildBlogListingPageSchemas({
  baseUrl,
  category,
  currentPage,
  isCleanCategoryRoute,
  itemListSchemaUrl,
  merchantLogoUrl,
  merchantName,
  organizationId,
  posts,
  searchQuery,
  totalPosts,
}: {
  baseUrl: string;
  category?: string;
  currentPage: number;
  isCleanCategoryRoute: boolean;
  itemListSchemaUrl?: string;
  merchantLogoUrl: string | null | undefined;
  merchantName: string;
  organizationId: string;
  posts: BlogListingSchemaPost[];
  searchQuery?: string;
  totalPosts: number;
}) {
  const blogSchema = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    '@id': `${baseUrl}/blog#blog`,
    name: `${merchantName} Blog`,
    description: `Read the latest articles, news, and insights from ${merchantName}.`,
    url: `${baseUrl}/blog`,
    publisher: {
      '@type': 'Organization',
      '@id': organizationId,
      name: merchantName,
      logo: merchantLogoUrl
        ? {
            '@type': 'ImageObject',
            url: merchantLogoUrl,
          }
        : undefined,
    },
    blogPost: posts.slice(0, 10).map((post) => {
      const imageUrls = getBlogStructuredDataImageUrls(post);
      return {
        '@type': 'BlogPosting',
        headline: post.title,
        description: post.excerpt || '',
        url: `${baseUrl}/blog/${post.slug}`,
        datePublished: post.published_at,
        author: {
          '@type': 'Person',
          name: post.author_name || merchantName,
        },
        ...(imageUrls.length > 0 ? { image: imageUrls } : {}),
      };
    }),
  };
  const itemListPosts = posts.slice(0, 10);
  const itemListPositionOffset = (currentPage - 1) * BLOG_LISTING_PAGE_SIZE;
  const itemListSchemaSearch = searchQuery?.trim() || undefined;
  const hasItemListSchemaSearch = Boolean(itemListSchemaSearch);
  const effectiveItemListSchemaUrl =
    isCleanCategoryRoute &&
    (!category || hasItemListSchemaSearch || currentPage !== 1)
      ? undefined
      : itemListSchemaUrl;

  const itemListSchema =
    itemListPosts.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: `${merchantName} Blog articles`,
          url:
            effectiveItemListSchemaUrl ??
            buildBlogListingSchemaUrl({
              baseUrl,
              category,
              page: currentPage,
              search: itemListSchemaSearch,
            }),
          numberOfItems: totalPosts,
          itemListElement: itemListPosts.map((post, index) => ({
            '@type': 'ListItem',
            position: itemListPositionOffset + index + 1,
            url: `${baseUrl}/blog/${post.slug}`,
            name: post.title,
          })),
        }
      : undefined;
  const breadcrumbSchema = generateBreadcrumbSchema([
    {
      name: merchantName,
      url: baseUrl,
    },
    {
      name: 'Blog',
      url: `${baseUrl}/blog`,
    },
  ]);

  return {
    blogSchema,
    breadcrumbSchema,
    hasItemListSchemaSearch,
    itemListSchema,
  };
}
