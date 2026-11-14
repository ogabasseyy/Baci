import { headers } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { GET as getMerchantBlogFeed } from '@/app/api/blog/feed/[merchantSlug]/route';
import { xmlSafeFeedUrl } from '@/lib/blog-feed-normalize';
import { resolveStorefrontSitemapContextResult } from '../../../sitemap-data';

export const preferredRegion = 'dub1';

export interface StorefrontBlogFeedRouteContext {
  params: Promise<{ slug: string }>;
}

function escapeXmlAttribute(value: string): string {
  return xmlSafeFeedUrl(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&apos;');
}

function withCanonicalRssSelfLink(
  xml: string,
  canonicalFeedUrl: string
): string {
  const channelOpenTagPattern = /<channel(?:\s[^>]*)?>/i;
  if (!channelOpenTagPattern.test(xml)) {
    return xml;
  }

  const safeHref = escapeXmlAttribute(canonicalFeedUrl);
  const selfLinkPattern = /<atom:link\b([^>]*\brel=(["'])self\2[^>]*)(\/?)>/gi;

  if (selfLinkPattern.test(xml)) {
    selfLinkPattern.lastIndex = 0;
    return xml.replace(
      selfLinkPattern,
      (match, attrs: string, _quote: string, selfClose: string) => {
        if (/\bhref=(["'])[^"']*\1/i.test(attrs)) {
          const updatedAttrs = attrs.replace(
            /\bhref=(["'])[^"']*\1/i,
            `href="${safeHref}"`
          );
          return `<atom:link${updatedAttrs}${selfClose}>`;
        }
        return match.replace(/<atom:link\b/i, `<atom:link href="${safeHref}"`);
      }
    );
  }

  const xmlWithNamespace = xml.replace(
    /<rss\b([^>]*)>/i,
    (match, attrs: string) =>
      /\bxmlns:atom\s*=/.test(attrs)
        ? match
        : `<rss${attrs} xmlns:atom="http://www.w3.org/2005/Atom">`
  );
  return xmlWithNamespace.replace(
    channelOpenTagPattern,
    (channelOpenTag) =>
      `${channelOpenTag}\n        <atom:link href="${safeHref}" rel="self" type="application/rss+xml"/>`
  );
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

  const response = await getMerchantBlogFeed(request, {
    params: Promise.resolve({
      merchantSlug: sitemapResult.context.merchant.slug,
    }),
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !contentType.includes('xml')) {
    return response;
  }

  const xml = await response.text();
  const canonicalFeedUrl = `${sitemapResult.context.storeUrl}/blog/feed.xml`;
  const rewrittenXml = withCanonicalRssSelfLink(xml, canonicalFeedUrl);
  if (rewrittenXml === xml) {
    return new NextResponse(xml, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
  }

  const headersOut = new Headers(response.headers);
  headersOut.delete('content-length');
  headersOut.delete('content-md5');
  headersOut.delete('etag');

  return new NextResponse(rewrittenXml, {
    status: response.status,
    statusText: response.statusText,
    headers: headersOut,
  });
}
