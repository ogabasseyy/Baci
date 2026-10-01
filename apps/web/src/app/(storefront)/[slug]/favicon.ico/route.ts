import { type NextRequest, NextResponse } from 'next/server';
import { getMerchantSafe } from '@/lib/cached-data';

// Region pinning lives in vercel.json `regions` (dub1) — `preferredRegion`
// is deprecated and removed.

const FAVICON_CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=600';

function sanitizeRootDomain(value: string | undefined) {
  return (value || 'usebaci.com').trim().replace(/[\r\n]/g, '');
}

function getRequestUrl(request: NextRequest) {
  return request.nextUrl ?? new URL(request.url);
}

function createFallbackUrl(request: NextRequest) {
  const rootDomain = sanitizeRootDomain(process.env.NEXT_PUBLIC_ROOT_DOMAIN);
  const requestUrl = getRequestUrl(request);
  return new URL('/favicon.ico', `${requestUrl.protocol}//${rootDomain}`);
}

function createCachedRedirect(url: URL) {
  const response = NextResponse.redirect(url, 302);
  response.headers.set('Cache-Control', FAVICON_CACHE_CONTROL);
  return response;
}

function createFallbackRedirect(request: NextRequest) {
  return createCachedRedirect(createFallbackUrl(request));
}

function normalizeComparableUrl(url: URL) {
  const comparable = new URL(url.toString());
  comparable.hash = '';
  comparable.search = '';
  return comparable.toString();
}

function getCurrentFaviconRequestUrls(request: NextRequest) {
  const requestUrl = getRequestUrl(request);
  const requestUrls = new Set([normalizeComparableUrl(requestUrl)]);
  const hasMerchantRewriteContext = Boolean(
    request.headers.get('x-custom-domain') ||
      request.headers.get('x-merchant-domain') ||
      request.headers.get('x-merchant-slug')
  );

  if (hasMerchantRewriteContext) {
    const publicFaviconUrl = new URL(requestUrl.toString());
    publicFaviconUrl.pathname = '/favicon.ico';
    requestUrls.add(normalizeComparableUrl(publicFaviconUrl));
  }

  return requestUrls;
}

function isCurrentFaviconRequest(url: URL, request: NextRequest) {
  return getCurrentFaviconRequestUrls(request).has(normalizeComparableUrl(url));
}

function resolveSafeFaviconUrl(
  candidateUrl: string | null | undefined,
  request: NextRequest,
  slug: string
) {
  if (!candidateUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(candidateUrl);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      console.warn(
        `[Favicon Router] Blocked unsafe redirect protocol: ${parsedUrl.protocol} for merchant ${slug}`
      );
      return null;
    }

    if (isCurrentFaviconRequest(parsedUrl, request)) {
      console.warn(
        `[Favicon Router] Skipped self-referential favicon URL for merchant ${slug}`
      );
      return null;
    }

    return parsedUrl;
  } catch (urlError) {
    console.error(
      `[Favicon Router] Invalid merchant favicon URL: ${candidateUrl} for merchant ${slug}`,
      urlError
    );
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const merchant = await getMerchantSafe(slug);
    if (!merchant) {
      return createFallbackRedirect(request);
    }

    const candidateUrls = [
      merchant.favicon_png_32_url,
      merchant.favicon_svg_url,
      merchant.favicon_apple_touch_url,
      merchant.logo_url,
    ];

    for (const candidateUrl of candidateUrls) {
      const safeUrl = resolveSafeFaviconUrl(candidateUrl, request, slug);
      if (safeUrl) {
        return createCachedRedirect(safeUrl);
      }
    }

    return createFallbackRedirect(request);
  } catch (err) {
    console.error(
      `[Favicon Router] Failed to resolve favicon for merchant ${slug}:`,
      err
    );
    return createFallbackRedirect(request);
  }
}
