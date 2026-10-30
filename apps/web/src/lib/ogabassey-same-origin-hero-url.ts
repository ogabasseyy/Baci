import { DEFAULT_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import { ogabasseyCdnImageProxyPathSchema } from '@/schemas/ogabassey-cdn-image-proxy';
import { ogabasseyCdnImageProxySearchParamsSchema } from '@/schemas/ogabassey-cdn-image-query';

const OGABASSEY_CDN_HOSTNAME = new URL(DEFAULT_MEDIA_CDN_ORIGIN).hostname;
const OGABASSEY_IMAGE_TRANSFORM_PREFIX = '/image/';
const OGABASSEY_SAME_ORIGIN_IMAGE_TRANSFORM_PREFIX = '/cdn-image/';
const PROXY_EXCLUDED_LOWERCASE_EXTENSION_PATTERN = /\.(?:avif|jpe?g|png|webp)$/;

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

  if (!ogabasseyCdnImageProxyPathSchema.safeParse(decodedSegments).success) {
    return url;
  }

  const rawSearchEntries = Array.from(parsed.searchParams.entries());
  const hasDuplicateKeys =
    new Set(rawSearchEntries.map(([key]) => key)).size !==
    rawSearchEntries.length;
  const parsedQuery = ogabasseyCdnImageProxySearchParamsSchema.safeParse(
    Object.fromEntries(rawSearchEntries)
  );
  if (hasDuplicateKeys || !parsedQuery.success) {
    return url;
  }

  return `${OGABASSEY_SAME_ORIGIN_IMAGE_TRANSFORM_PREFIX}${remainder}${parsed.search}${parsed.hash}`;
}
