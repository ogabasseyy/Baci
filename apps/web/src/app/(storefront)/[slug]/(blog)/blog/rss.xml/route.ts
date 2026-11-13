import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { resolveStorefrontSitemapContext } from '../../../sitemap-data';

export const preferredRegion = 'dub1';

export interface StorefrontBlogRssRouteContext {
  params: Promise<{ slug: string }>;
}

/**
 * Permanently redirects `/blog/rss.xml` to the canonical `/blog/feed.xml` RSS URL
 * so requests do not fall through to the `[postSlug]` page route.
 */
export async function GET(
  request: Request,
  routeContext: StorefrontBlogRssRouteContext
): Promise<Response> {
  const { slug } = await routeContext.params;
  const headersList = await headers();
  const sitemapContext = await resolveStorefrontSitemapContext(
    headersList,
    slug,
    request
  );

  if (!sitemapContext?.merchant.feature_settings?.blog_enabled) {
    return new NextResponse('Blog feed not found', { status: 404 });
  }

  return NextResponse.redirect(`${sitemapContext.storeUrl}/blog/feed.xml`, 308);
}
