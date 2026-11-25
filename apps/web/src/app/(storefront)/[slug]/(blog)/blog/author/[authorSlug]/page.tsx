import type { Metadata } from 'next';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { resolveBlogCatchAllOutcome } from '@/app/(storefront)/[slug]/(blog)/blog/[...catchAll]/blog-catch-all-resolution';
import { OGABASSEY_DOMAIN } from '@/config/ogabassey';
import { getBlogAuthorBySlug, getBlogAuthorSlugs } from '@/lib/blog-authors';
import { getCachedBlogAuthor } from '@/lib/cached-data';
import { asRoute } from '@/lib/routes';
import { buildStoreUrl } from '@/lib/store-url';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import {
  getStorefrontOpenGraphImages,
  getStorefrontTwitterImages,
} from '@/lib/storefront-social-images';
import { BlogListingFallback } from '../../BlogListingFallback';
import { parseBlogListingPage } from '../../blog-listing-page-params';
import {
  type BlogSearchParamValue,
  toSingleBlogSearchParam,
} from '../../blog-search-params';
import { BlogAuthorPageContent } from './blog-author-page-content';

interface AuthorPageProps {
  params: Promise<{ slug: string; authorSlug: string }>;
  searchParams?: Promise<{ page?: BlogSearchParamValue }>;
}

// Cache Components invariant: generateMetadata stays request-searchParams-free
// for the STATIC tenant so its metadata prerenders (streamed metadata is
// withheld from DOM bots by htmlLimitedBots). Non-static author pages read
// ?page for page-scoped noindex variants. The author content reads searchParams
// and renders behind Suspense for all tenants, so pagination keeps working; the
// Suspense fallback is the prerenderable static shell.

const AUTHOR_NOT_FOUND_METADATA: Metadata = {
  title: 'Author Not Found',
  robots: { index: false, follow: false },
};

const OGABASSEY_AUTHOR_STATIC_TENANTS = [
  OGABASSEY_DOMAIN,
  'ogabassey',
] as const;

export function generateStaticParams(): Array<{
  slug: string;
  authorSlug: string;
}> {
  return OGABASSEY_AUTHOR_STATIC_TENANTS.flatMap((slug) =>
    getBlogAuthorSlugs().map((authorSlug) => ({ slug, authorSlug }))
  );
}

export async function generateMetadata({
  params,
  searchParams,
}: AuthorPageProps): Promise<Metadata> {
  const { slug, authorSlug } = await params;
  const normalizedAuthorSlug = authorSlug.toLowerCase();

  const profile = getBlogAuthorBySlug(normalizedAuthorSlug, slug);
  if (!profile) {
    return AUTHOR_NOT_FOUND_METADATA;
  }

  // Static tenant metadata stays request-searchParams-free (prerenderable);
  // non-static author pages read ?page for page-scoped noindex variants.
  const page = isStaticAuthorTenant(slug)
    ? 1
    : parseBlogListingPage(toSingleBlogSearchParam((await searchParams)?.page));

  const data = await getCachedBlogAuthor(slug, profile.name, { page });
  if (!data) {
    return AUTHOR_NOT_FOUND_METADATA;
  }

  const { merchant, author } = data;
  const baseUrl = buildStoreUrl(merchant);
  const authorBaseUrl = `${baseUrl}/blog/author/${normalizedAuthorSlug}`;
  const canonicalUrl =
    page > 1 ? `${authorBaseUrl}?page=${page}` : authorBaseUrl;
  const roleLine = author.title
    ? `${author.title} at ${merchant.business_name}`
    : `Writer at ${merchant.business_name}`;
  const { metadataTitle, title } = buildStorefrontMetadataTitle({
    title: author.title ? `${author.name} — ${author.title}` : author.name,
    suffix: merchant.business_name,
    fallback: author.name,
  });
  const description =
    author.bio || `Read the latest articles by ${author.name}, ${roleLine}.`;

  return {
    title: metadataTitle,
    description,
    openGraph: {
      title,
      description,
      type: 'profile',
      url: canonicalUrl,
      siteName: merchant.business_name,
      images: getStorefrontOpenGraphImages(
        baseUrl,
        author.name,
        author.imageUrl,
        merchant.logo_url
      ),
    },
    twitter: {
      card: 'summary',
      title,
      description,
      images: getStorefrontTwitterImages(
        baseUrl,
        author.imageUrl,
        merchant.logo_url
      ),
    },
    alternates: { canonical: canonicalUrl },
    robots:
      page > 1
        ? { index: false, follow: true }
        : {
            index: true,
            follow: true,
            'max-image-preview': 'large',
            'max-snippet': -1,
          },
  };
}

function isStaticAuthorTenant(slug: string): boolean {
  return OGABASSEY_AUTHOR_STATIC_TENANTS.some(
    (staticTenantSlug) => staticTenantSlug === slug
  );
}

// Unknown-author status decisions (404/308) must resolve before any streaming
// so we never emit a soft-404. Known authors fall through. Runs for every
// tenant, including the static OgaBassey one.
async function assertAuthorRouteStatusBeforeShell({
  slug,
  authorSlug,
}: {
  slug: string;
  authorSlug: string;
}): Promise<void> {
  const normalizedAuthorSlug = authorSlug.toLowerCase();
  const profile = getBlogAuthorBySlug(normalizedAuthorSlug, slug);
  if (profile) {
    return;
  }

  const fallbackOutcome = await resolveBlogCatchAllOutcome({
    params: Promise.resolve({
      slug,
      catchAll: ['author', normalizedAuthorSlug],
    }),
  });

  if (fallbackOutcome.type === 'redirect') {
    if (fallbackOutcome.status === 308) {
      permanentRedirect(asRoute(fallbackOutcome.url));
    }
    redirect(asRoute(fallbackOutcome.url));
  }

  notFound();
}

export default async function BlogAuthorPage({
  params,
  searchParams,
}: AuthorPageProps) {
  const resolvedParams = await params;

  await assertAuthorRouteStatusBeforeShell(resolvedParams);

  return (
    <Suspense fallback={<BlogListingFallback />}>
      <BlogAuthorPageContent
        params={Promise.resolve(resolvedParams)}
        searchParams={searchParams}
      />
    </Suspense>
  );
}
