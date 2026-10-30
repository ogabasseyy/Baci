import { DEFAULT_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import { parseOgabasseyCdnImageProxyPath } from '@/lib/parse-ogabassey-cdn-image-proxy-path';

const OGABASSEY_CDN_HOSTNAME = new URL(DEFAULT_MEDIA_CDN_ORIGIN).hostname;
const OGABASSEY_IMAGE_TRANSFORM_PREFIX = '/image/';
const OGABASSEY_SAME_ORIGIN_IMAGE_TRANSFORM_PREFIX = '/cdn-image/';
const PROXY_EXCLUDED_LOWERCASE_EXTENSION_PATTERN = /\.(?:avif|jpe?g|png|webp)$/;
const ALLOWED_IMAGE_VERSION_QUERY_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function hasValidProxySearchParams(searchParams: URLSearchParams): boolean {
  const entries = Array.from(searchParams.entries());
  if (entries.length === 0) {
    return true;
  }
  if (entries.length > 1) {
    return false;
  }
  const [key, value] = entries[0];
  return key === 'v' && ALLOWED_IMAGE_VERSION_QUERY_PATTERN.test(value);
}

/**
 * Rewrites an OgaBassey CDN transform URL (`https://cdn.ogabassey.com/image/...`)
 * to its same-origin `/cdn-image/...` path so homepage hero `<link rel="preload">`,
 * `<source srcset>`, and `<img src>` avoid a cross-origin DNS/TCP/TLS handshake on
 * Slow-4G while preserving non-CDN, data, or route-ineligible URLs unchanged.
 */
export function toOgabasseySameOriginTransformUrl(url: string): string {
  if (url.startsWith(OGABASSEY_SAME_ORIGIN_IMAGE_TRANSFORM_PREFIX)) {
    return url;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (
    parsed.hostname !== OGABASSEY_CDN_HOSTNAME ||
    !parsed.pathname.startsWith(OGABASSEY_IMAGE_TRANSFORM_PREFIX)
  ) {
    return url;
  }
  const remainder = parsed.pathname.slice(
    OGABASSEY_IMAGE_TRANSFORM_PREFIX.length
  );
  if (!PROXY_EXCLUDED_LOWERCASE_EXTENSION_PATTERN.test(remainder)) {
    return url;
  }

  let decodedSegments: string[];
  try {
    decodedSegments = remainder
      .split('/')
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return url;
  }

  if (
    !parseOgabasseyCdnImageProxyPath(decodedSegments) ||
    !hasValidProxySearchParams(parsed.searchParams)
  ) {
    return url;
  }

  return `${OGABASSEY_SAME_ORIGIN_IMAGE_TRANSFORM_PREFIX}${remainder}${parsed.search}${parsed.hash}`;
}
