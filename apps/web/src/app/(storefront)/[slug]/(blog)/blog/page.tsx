import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BlogListingFallback } from './BlogListingFallback';
import {
  isOgabasseyBlogStaticTenant,
  OGABASSEY_BLOG_STATIC_TENANTS,
} from './blog-category-routing';
import { buildBlogListingMetadata } from './blog-listing-metadata';
import { BlogListingRequestContent } from './blog-listing-request-content';
import type { BlogPageProps } from './blog-page-content';

// Cache Components invariant for this route:
// - generateMetadata must be request-searchParams-free for the STATIC tenant so
//   its metadata prerenders. Awaiting searchParams there forces metadata to
//   stream, which htmlLimitedBots then withholds from DOM bots — the cause of
//   the generic `Ogabassey` title seen for Googlebot. Non-static tenants render
//   dynamically, so their metadata may read searchParams to keep query-specific
//   noindex/self-canonical variants (search/pagination/category).
// - Hero selection must resolve searchParams with the listing. Otherwise page
//   two repeats page one's hero and loses its own first story. This request
//   boundary preserves correctness; it is not a proven static-shell LCP win.

export function generateStaticParams(): Array<{ slug: string }> {
  return OGABASSEY_BLOG_STATIC_TENANTS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
  searchParams,
}: BlogPageProps): Promise<Metadata> {
  const { slug } = await params;

  if (isOgabasseyBlogStaticTenant(slug)) {
    return buildBlogListingMetadata({ slug, searchParams: {} });
  }

  return buildBlogListingMetadata({ slug, searchParams: await searchParams });
}

export default function BlogPage({ params, searchParams }: BlogPageProps) {
  return (
    <Suspense fallback={<BlogListingFallback />}>
      <BlogListingRequestContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
