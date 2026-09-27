import { type NextRequest, NextResponse } from 'next/server';
import {
  ANALYTICS_CONVERSION_API_PATH,
  isLegacyAnalyticsConversionPath,
  isLegacyKlumpWooCommerceWebhookPath,
  KLUMP_WEBHOOK_API_PATH,
} from '@/lib/proxy/api-alias';
import { isLocalhost, normalizeHostname } from '@/lib/proxy/host';
import { resolveUnsafeStorefrontPdpPath } from '@/lib/proxy/preflight-common';
import { applySecurityHeaders } from '@/lib/proxy/response-headers';
import { BLOG_PATH_REGEX } from '@/lib/proxy/routing-constants';

export function runLegacyRoutingStage(
  request: NextRequest,
  pathname: string,
  hostname: string,
  userAgent: string
): NextResponse | null {
  const legacyAnalytics =
    isLegacyAnalyticsConversionPath(pathname) && request.method === 'POST';
  const legacyKlump = isLegacyKlumpWooCommerceWebhookPath(pathname);
  if (legacyKlump) {
    const response = applySecurityHeaders(
      NextResponse.json(
        { error: 'Legacy Klump WooCommerce webhook endpoint retired' },
        { status: 410 }
      ),
      KLUMP_WEBHOOK_API_PATH,
      userAgent,
      'api',
      isLocalhost(hostname),
      undefined,
      request,
      hostname
    );
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  if (legacyAnalytics) {
    return applySecurityHeaders(
      NextResponse.rewrite(
        new URL(
          ANALYTICS_CONVERSION_API_PATH + request.nextUrl.search,
          request.url
        )
      ),
      ANALYTICS_CONVERSION_API_PATH,
      userAgent,
      'api',
      isLocalhost(hostname),
      undefined,
      request,
      hostname
    );
  }
  if (normalizeHostname(hostname) === 'blog.ogabassey.com') {
    let cleanPath = pathname;
    const rootDomain = normalizeHostname(hostname).replace(/^blog\./, '');
    if (
      cleanPath.toLowerCase().startsWith(`/${rootDomain}/`) ||
      cleanPath.toLowerCase() === `/${rootDomain}`
    )
      cleanPath = cleanPath.slice(`/${rootDomain}`.length) || '/';
    if (cleanPath.startsWith('/blog/') || cleanPath === '/blog') {
      cleanPath = cleanPath.slice('/blog'.length) || '/';
    }
    if (cleanPath.length > 1 && cleanPath.endsWith('/')) {
      cleanPath = cleanPath.replace(/\/+$/, '') || '/';
    }
    const datedPermalink = cleanPath.match(
      /^\/\d{4}\/\d{2}\/\d{2}\/([^/]+?)\/?$/
    );
    if (datedPermalink) cleanPath = `/${datedPermalink[1]}`;
    return NextResponse.redirect(
      `https://ogabassey.com/blog${cleanPath === '/' ? '' : cleanPath}`,
      { status: 301 }
    );
  }
  const unsafeStorefrontPdpPath = resolveUnsafeStorefrontPdpPath(
    request,
    pathname,
    hostname,
    userAgent
  );
  if (unsafeStorefrontPdpPath) return unsafeStorefrontPdpPath;
  if (
    /^\/(?:[^/]+\/)?blog\/(?:wp-admin|wp-login\.php|xmlrpc\.php)(?:\/|$)/i.test(
      pathname
    )
  ) {
    return new NextResponse('Gone', { status: 410 });
  }
  if (pathname.startsWith('/blog/')) {
    const lowerBlogPath = pathname.toLowerCase();
    const spamPatterns = [
      '/blog/shopdetail',
      '/blog/zhhant',
      '/blog/product',
      '/blog/category/product',
    ];
    if (
      spamPatterns.some(
        (pattern) =>
          lowerBlogPath === pattern || lowerBlogPath.startsWith(`${pattern}/`)
      )
    ) {
      return new NextResponse('Gone', { status: 410 });
    }
    const match = pathname.match(/^\/blog\/([^/]+)\/([^/]+)\/?$/);
    const target = match?.[2]?.toLowerCase();
    const base = target?.replace(/\.(?:avif|gif|jpe?g|png|webp)$/, '');
    const metadata =
      base !== undefined && ['opengraph-image', 'twitter-image'].includes(base);
    const document =
      request.headers.get('sec-fetch-dest')?.toLowerCase() === 'document' ||
      (request.headers.get('accept')?.toLowerCase() ?? '').includes(
        'text/html'
      );
    const legacyPost =
      (match &&
        !metadata &&
        !['page', 'tag', 'author', 'category'].includes(
          match[1].toLowerCase()
        )) ||
      (match &&
        metadata &&
        document &&
        !['page', 'tag', 'author', 'category'].includes(
          match[1].toLowerCase()
        ));
    const thumbnail =
      request.nextUrl.searchParams.has('thumbnail_id') ||
      request.nextUrl.searchParams.has('_thumbnail_id');
    if (legacyPost || thumbnail) {
      const url = request.nextUrl.clone();
      if (legacyPost && match) url.pathname = `/blog/${match[2]}`;
      url.searchParams.delete('thumbnail_id');
      url.searchParams.delete('_thumbnail_id');
      if (url.pathname !== pathname || url.search !== request.nextUrl.search) {
        return NextResponse.redirect(url, { status: 301 });
      }
    }
  }
  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    BLOG_PATH_REGEX.test(pathname) &&
    (request.nextUrl.searchParams.has('thumbnail_id') ||
      request.nextUrl.searchParams.has('_thumbnail_id'))
  ) {
    const url = request.nextUrl.clone();
    url.searchParams.delete('thumbnail_id');
    url.searchParams.delete('_thumbnail_id');
    return NextResponse.redirect(url, 301);
  }
  return null;
}
