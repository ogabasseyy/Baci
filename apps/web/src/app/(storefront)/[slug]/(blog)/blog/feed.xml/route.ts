import { headers } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { GET as getMerchantBlogFeed } from '@/app/api/blog/feed/[merchantSlug]/route';
import { resolveStorefrontSitemapContextResult } from '../../../sitemap-data';

export const preferredRegion = 'dub1';

export interface StorefrontBlogFeedRouteContext {
  params: Promise<{ slug: string }>;
}

/**
 * Serves the storefront RSS 2.0 feed at `/blog/feed.xml` (and `/{slug}/blog/feed.xml`)
 * so requests do not fall through to the `[postSlug]` page route.
 */
export async function GET(
  request: NextRequest,
  routeContext: StorefrontBlogFeedRouteContext
): Promise<Response> {
  const { slug } = await routeContext.params;
  const headersList = await headers();
  const sitemapResult = await resolveStorefrontSitemapContextResult(
    headersList,
    slug,
    request
  );

  if (sitemapResult.status === 'unavailable') {
    return new NextResponse('Blog feed temporarily unavailable', {
      status: 503,
    });
  }

  if (
    sitemapResult.status !== 'found' ||
    !sitemapResult.context.merchant.feature_settings?.blog_enabled
  ) {
    return new NextResponse('Blog feed not found', { status: 404 });
  }

  return getMerchantBlogFeed(request, {
    params: Promise.resolve({
      merchantSlug: sitemapResult.context.merchant.slug,
    }),
  });
}
