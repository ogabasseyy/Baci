import type { ReactNode } from 'react';
import { isOgabasseyBlogStaticTenant } from './blog-category-routing';
import type { BlogSearchParamValue } from './blog-search-params';
import { isUnfilteredOgabasseyBlogListing } from './is-unfiltered-ogabassey-blog-listing';

interface BlogListingQueryContentProps {
  children: ReactNode;
  hero: ReactNode;
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, BlogSearchParamValue>>;
}

export async function BlogListingQueryContent({
  children,
  hero,
  params,
  searchParams,
}: BlogListingQueryContentProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const unfiltered = isUnfilteredOgabasseyBlogListing(slug, query);
  const showHero = hero !== null && unfiltered;
  const filteredStaticListing =
    isOgabasseyBlogStaticTenant(slug) && !unfiltered;

  return (
    <>
      {filteredStaticListing ? (
        <div data-blog-listing-filtered="" hidden />
      ) : null}
      {showHero ? hero : null}
      {children}
    </>
  );
}
