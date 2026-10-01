import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { InformationalClusterIndex } from '@/components/storefront/ogabassey/seo/informational-cluster-index';
import { getBlogAuthorPageLinks } from '@/lib/blog-authors';
import { BLOG_LISTING_PAGE_SIZE } from '@/lib/blog-listing-page-size';
import { buildBlogOrganizationId } from '@/lib/blog-organization-id';
import { buildBlogOrganizationSchema } from '@/lib/blog-organization-schema';
import { getCachedBlogListing } from '@/lib/cached-data';
import type { JsonLdScriptData } from '@/lib/json-ld-types';
import { filterPublicBlogCategories } from '@/lib/public-blog-content-quality';
import { asRoute } from '@/lib/routes';
import { buildStoreUrl } from '@/lib/store-url';
import { buildBlogClusterCollections } from '@/lib/storefront-content/build-blog-cluster-collections';
import {
  clampBlogSearchQuery,
  evaluateStorefrontSlugSafety,
} from '@/lib/storefront-slug-safety';
import { BlogCategoryGuide } from './blog-category-guide';
import {
  buildBlogCategoryHref,
  isOgabasseyBlogStaticTenant,
} from './blog-category-routing';
import { BlogDiscoverySection } from './blog-discovery-section';
import {
  appendPreservedBlogCategoryRedirectParams,
  findPublicCategoryLabel,
} from './blog-listing-category-redirect';
import { preloadOgabasseyRootBlogListingHeroImage } from './blog-listing-hero-image-preload';
import { parseBlogListingPage } from './blog-listing-page-params';
import { buildBlogListingRouteHref } from './blog-listing-route';
import { buildBlogListingSchemaUrl } from './blog-listing-schema-url';
import { BlogListingTemplatePage } from './blog-listing-template-page';
import {
  type BlogSearchParamValue,
  toSingleBlogSearchParam,
} from './blog-search-params';
import { buildBlogListingPageSchemas } from './build-blog-listing-page-schemas';
import { DefaultBlogUi } from './default-blog-ui';
import { ogabasseyBlogLcpSnapshot } from './ogabassey-blog-lcp-snapshot';
import {
  shouldHideCommittedBlogSnapshot,
  shouldHideLiveBlogFeaturedStory,
} from './should-hide-live-blog-featured-story';

export interface BlogPageProps {
  categoryOverride?: string;
  hideFeaturedStory?: boolean;
  isCleanCategoryRoute?: boolean;
  itemListSchemaUrl?: string;
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    [key: string]: BlogSearchParamValue;
    category?: BlogSearchParamValue;
    page?: BlogSearchParamValue;
    search?: BlogSearchParamValue;
  }>;
}

export async function BlogPageContent({
  categoryOverride,
  hideFeaturedStory = false,
  isCleanCategoryRoute = false,
  itemListSchemaUrl,
  params,
  searchParams,
}: BlogPageProps) {
  const { slug } = await params;
  const searchParamValues = await searchParams;
  const category =
    categoryOverride ?? toSingleBlogSearchParam(searchParamValues.category);
  const page = toSingleBlogSearchParam(searchParamValues.page);
  const search = toSingleBlogSearchParam(searchParamValues.search);
  const currentPage = parseBlogListingPage(page);
  // An over-long / repeatedly-encoded category can never match a listing; bail
  // before getCachedBlogListing (`'use cache'`) runs with an unbounded key (its
  // cache key + tag both include the raw category). Search is free-form text,
  // not a slug, so it is clamped (bounding the key) rather than 404'd.
  if (category && !evaluateStorefrontSlugSafety(category).safe) {
    notFound();
  }
  const data = await getCachedBlogListing(slug, {
    category,
    page: currentPage,
    searchQuery: clampBlogSearchQuery(search),
  });
  if (!data) {
    notFound();
  }
  const { merchant, posts, categories, totalPosts, searchQuery } = data;
  const liveFeaturedSlug = posts[0]?.slug;
  const snapshotSlug = ogabasseyBlogLcpSnapshot.featuredPost.slug;
  const hideLiveFeatured = shouldHideLiveBlogFeaturedStory({
    liveFeaturedSlug,
    preferSnapshot: hideFeaturedStory,
    snapshotSlug,
  });
  const hideCommittedSnapshot = shouldHideCommittedBlogSnapshot({
    liveFeaturedSlug,
    preferSnapshot: hideFeaturedStory,
    snapshotSlug,
  });
  const committedSnapshotMarker = hideCommittedSnapshot ? (
    <div data-blog-live-featured="" hidden />
  ) : null;
  const effectiveSearchQuery = searchQuery ?? search;
  const totalPages = Math.max(
    1,
    Math.ceil(totalPosts / BLOG_LISTING_PAGE_SIZE)
  );
  const publicCategories = filterPublicBlogCategories(categories);
  const baseUrl = buildStoreUrl(merchant);
  const organizationSchema = buildBlogOrganizationSchema(merchant, baseUrl);
  const organizationId =
    typeof organizationSchema['@id'] === 'string'
      ? organizationSchema['@id']
      : buildBlogOrganizationId(baseUrl);
  const basePath = baseUrl;
  const authorLinks = getBlogAuthorPageLinks(slug);

  if (!isCleanCategoryRoute && category && !search && currentPage === 1) {
    const categoryLabel = findPublicCategoryLabel(publicCategories, category);
    if (categoryLabel) {
      const categoryHref = buildBlogCategoryHref(
        basePath,
        categoryLabel,
        publicCategories
      );
      if (!categoryHref.includes('?')) {
        permanentRedirect(
          asRoute(
            appendPreservedBlogCategoryRedirectParams(
              categoryHref,
              searchParamValues
            )
          )
        );
      }
    }
  }

  if (currentPage > totalPages) {
    redirect(
      asRoute(
        buildBlogListingRouteHref({
          storeBasePath: basePath,
          category,
          page: totalPages,
          search: effectiveSearchQuery,
        })
      )
    );
  }
  const previousPageUrl =
    currentPage > 1
      ? buildBlogListingSchemaUrl({
          baseUrl,
          category,
          page: currentPage - 1,
          search: effectiveSearchQuery,
        })
      : undefined;
  const nextPageUrl =
    currentPage < totalPages
      ? buildBlogListingSchemaUrl({
          baseUrl,
          category,
          page: currentPage + 1,
          search: effectiveSearchQuery,
        })
      : undefined;
  const paginationHeadLinks = (
    <>
      {previousPageUrl ? <link href={previousPageUrl} rel="prev" /> : null}
      {nextPageUrl ? <link href={nextPageUrl} rel="next" /> : null}
    </>
  );
  const guideCollections = buildBlogClusterCollections({
    storeUrl: baseUrl,
    posts: posts.map((post) => ({
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      category: post.category,
      tags: post.tags ?? null,
      keywords: null,
      featured_image_url: post.featured_image_url,
      published_at: post.published_at,
      reading_time_minutes: post.reading_time_minutes,
    })),
  });
  if (!hideLiveFeatured) {
    preloadOgabasseyRootBlogListingHeroImage({
      category,
      posts,
      searchQuery: effectiveSearchQuery,
      templateId: merchant.template_id,
    });
  }
  const schemas = buildBlogListingPageSchemas({
    baseUrl,
    category,
    currentPage,
    isCleanCategoryRoute,
    itemListSchemaUrl,
    merchantLogoUrl: merchant.logo_url,
    merchantName: merchant.business_name,
    organizationId,
    posts,
    searchQuery: effectiveSearchQuery,
    totalPosts,
  });
  const categoryGuide =
    category && !effectiveSearchQuery ? (
      <BlogCategoryGuide
        category={category}
        isOgabasseyBlogTenant={isOgabasseyBlogStaticTenant(slug)}
        merchantName={merchant.business_name}
        totalPosts={totalPosts}
      />
    ) : undefined;
  const templateId = merchant.template_id;
  if (templateId) {
    const templatePage = await BlogListingTemplatePage({
      authorLinks,
      basePath,
      blogSchema: schemas.blogSchema as JsonLdScriptData,
      breadcrumbSchema: schemas.breadcrumbSchema as JsonLdScriptData,
      category,
      categoryGuide,
      committedSnapshotMarker,
      currentPage,
      effectiveSearchQuery,
      guideCollections,
      hasItemListSchemaSearch: schemas.hasItemListSchemaSearch,
      hideLiveFeatured,
      itemListSchema: schemas.itemListSchema as JsonLdScriptData | undefined,
      merchantName: merchant.business_name,
      organizationSchema: organizationSchema as JsonLdScriptData,
      paginationHeadLinks,
      posts,
      publicCategories,
      storeUrl: baseUrl,
      templateId,
      totalPages,
    });
    if (templatePage) {
      return templatePage;
    }
  }

  return (
    <>
      {committedSnapshotMarker}
      {paginationHeadLinks}
      <DefaultBlogUi
        blogSchema={schemas.blogSchema as JsonLdScriptData}
        breadcrumbSchema={schemas.breadcrumbSchema as JsonLdScriptData}
        organizationSchema={organizationSchema as JsonLdScriptData}
        itemListSchema={schemas.itemListSchema as JsonLdScriptData | undefined}
        basePath={basePath}
        categories={publicCategories}
        categoryGuide={categoryGuide}
        category={category}
        merchant={merchant}
        posts={posts}
        searchQuery={effectiveSearchQuery}
        slug={slug}
        totalPosts={totalPosts}
        currentPage={currentPage}
      />
      <InformationalClusterIndex collections={guideCollections} />
      <BlogDiscoverySection
        baseUrl={baseUrl}
        authors={authorLinks}
        categories={publicCategories}
        posts={posts}
      />
    </>
  );
}
