import type { Metadata } from 'next';
import { getCachedBlogListing } from '@/lib/cached-data';
import { filterPublicBlogCategories } from '@/lib/public-blog-content-quality';
import { generateMetaDescription } from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import {
  clampBlogSearchQuery,
  evaluateStorefrontSlugSafety,
} from '@/lib/storefront-slug-safety';
import {
  getStorefrontOpenGraphImages,
  getStorefrontTwitterImages,
} from '@/lib/storefront-social-images';
import {
  buildBlogCategorySchemaUrl,
  findBlogCategoryLabelBySlug,
  findOgabasseyBlogCategoryAliasLabel,
  getBlogCategorySlug,
  isOgabasseyBlogStaticTenant,
} from './blog-category-routing';
import { parseBlogListingPage } from './blog-listing-page-params';
import { buildBlogListingSchemaUrl } from './blog-listing-schema-url';
import {
  type BlogSearchParamValue,
  toSingleBlogSearchParam,
} from './blog-search-params';

const LOWERCASE_TITLE_WORDS = new Set(['and', 'for', 'of', 'the', 'to']);

export interface BlogListingMetadataInput {
  canonicalUrl?: string;
  indexable?: boolean;
  searchParams: {
    category?: BlogSearchParamValue;
    page?: BlogSearchParamValue;
    search?: BlogSearchParamValue;
  };
  slug: string;
}

function normalizeBlogMetadataText(value: string | undefined): string {
  return value?.trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
}

function formatBlogFilterLabel(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word, index) =>
      index > 0 && LOWERCASE_TITLE_WORDS.has(word.toLowerCase())
        ? word.toLowerCase()
        : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`
    )
    .join(' ');
}

export async function buildBlogListingMetadata({
  canonicalUrl: explicitCanonicalUrl,
  indexable,
  searchParams,
  slug,
}: BlogListingMetadataInput): Promise<Metadata> {
  const filterCategory = toSingleBlogSearchParam(searchParams.category)?.trim();
  // Search is free-form text, not a slug — clamp it (bounding the cached-lookup
  // key) rather than 404'ing, and clamp before display normalization too.
  const filterSearch = clampBlogSearchQuery(
    toSingleBlogSearchParam(searchParams.search)
  );
  // An over-long / repeatedly-encoded category can never match a listing;
  // return the not-found metadata before getCachedBlogListing (`'use cache'`)
  // runs with an unbounded key.
  if (filterCategory && !evaluateStorefrontSlugSafety(filterCategory).safe) {
    return {
      title: 'Blog Not Found',
      robots: { index: false, follow: false },
    };
  }
  const currentPage = parseBlogListingPage(
    toSingleBlogSearchParam(searchParams.page)
  );
  const normalizedCategory = normalizeBlogMetadataText(filterCategory);
  const normalizedSearch = normalizeBlogMetadataText(filterSearch);
  const listingOptions: {
    category?: string;
    page: number;
    searchQuery?: string;
  } = { page: currentPage };

  if (filterCategory) {
    listingOptions.category = filterCategory;
  }

  if (filterSearch) {
    listingOptions.searchQuery = filterSearch;
  }

  const data = await getCachedBlogListing(slug, listingOptions);
  if (!data) {
    return {
      title: 'Blog Not Found',
      robots: { index: false, follow: false },
    };
  }

  const { merchant } = data;
  const baseUrl = buildStoreUrl(merchant);
  const totalPages = Math.max(1, data.totalPages);
  const canonicalPage = Math.min(currentPage, totalPages);
  const categoryLabel = normalizedCategory
    ? formatBlogFilterLabel(normalizedCategory)
    : '';
  const publicCategories = filterPublicBlogCategories(data.categories);
  let knownCategoryLabel = normalizedCategory
    ? findBlogCategoryLabelBySlug(
        publicCategories,
        getBlogCategorySlug(normalizedCategory)
      )
    : null;

  const isOgabasseyBlog = isOgabasseyBlogStaticTenant(slug);
  if (!knownCategoryLabel && normalizedCategory && isOgabasseyBlog) {
    knownCategoryLabel = findOgabasseyBlogCategoryAliasLabel(
      publicCategories,
      normalizedCategory
    );
  }

  // Canonical cases:
  // 1. Base blog: /blog.
  // 2. Known category page 1: /blog/category/<slug>.
  // 3. Known category page 2+: /blog?category=<label>&page=<n>.
  // 4. Unknown category: /blog.
  // 5. Category search: /blog?category=<label>&search=<query>.
  const shouldUseCleanCategoryCanonical =
    knownCategoryLabel && !normalizedSearch && canonicalPage === 1;
  const categoryCanonicalFilter =
    normalizedCategory &&
    (normalizedSearch || (knownCategoryLabel && canonicalPage > 1))
      ? filterCategory
      : undefined;
  const canonicalUrl =
    explicitCanonicalUrl ??
    (shouldUseCleanCategoryCanonical && knownCategoryLabel
      ? buildBlogCategorySchemaUrl(baseUrl, knownCategoryLabel)
      : buildBlogListingSchemaUrl({
          baseUrl,
          category: categoryCanonicalFilter,
          page: canonicalPage,
          search: data.searchQuery ?? filterSearch,
        }));
  const shouldIndex =
    indexable === true
      ? !normalizedSearch && currentPage === 1
      : !normalizedCategory && !normalizedSearch && currentPage === 1;
  const socialImageCandidates = [
    data.posts[0]?.featured_image_url,
    merchant.logo_url,
  ];
  const pageSuffix = currentPage > 1 ? ` | Page ${currentPage}` : '';
  const metadataTitleBase = normalizedSearch
    ? `Search: ${normalizedSearch}${pageSuffix}`
    : knownCategoryLabel
      ? `${knownCategoryLabel} Articles${pageSuffix}`
      : normalizedCategory
        ? `${categoryLabel} Articles${pageSuffix}`
        : `Blog${pageSuffix}`;
  const { metadataTitle, title: metadataTitleText } =
    buildStorefrontMetadataTitle({
      title: metadataTitleBase,
      suffix: merchant.business_name,
      fallback: 'Blog',
    });
  const baseDescription = normalizedSearch
    ? `Search results for "${normalizedSearch}" on ${merchant.business_name}'s blog.`
    : knownCategoryLabel
      ? `Read articles and updates about ${knownCategoryLabel.toLowerCase()} from ${merchant.business_name}.`
      : normalizedCategory
        ? `Read ${categoryLabel.toLowerCase()} articles and updates from ${merchant.business_name}.`
        : isOgabasseyBlog
          ? `Read the latest tech news, smartphone and laptop reviews, buying guides, and insights from ${merchant.business_name} Blog.`
          : `Read the latest articles, guides, and updates from ${merchant.business_name}.`;
  const pageAwareDescription =
    currentPage > 1
      ? `Page ${currentPage}: ${baseDescription}`
      : baseDescription;
  const fallback = isOgabasseyBlog
    ? `Explore expert tips, product comparisons, and maintenance guides curated by the ${merchant.business_name} team.`
    : `Explore articles, guides, and updates curated by the ${merchant.business_name} team.`;
  const description = generateMetaDescription(pageAwareDescription, 160, {
    minLength: 110,
    fallback,
  });

  return {
    title: metadataTitle,
    description,
    openGraph: {
      title: metadataTitleText,
      description,
      type: 'website',
      url: canonicalUrl,
      siteName: data.merchant.business_name,
      images: getStorefrontOpenGraphImages(
        baseUrl,
        `${data.merchant.business_name} blog`,
        ...socialImageCandidates
      ),
    },
    twitter: {
      card: 'summary_large_image',
      title: metadataTitleText,
      description,
      images: getStorefrontTwitterImages(baseUrl, ...socialImageCandidates),
    },
    alternates: {
      canonical: canonicalUrl,
      types: {
        'application/rss+xml': `${baseUrl}/api/blog/feed/${slug}`,
      },
    },
    robots: {
      index: shouldIndex,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  };
}
