import { DEFAULT_MEDIA_CDN_ORIGIN } from '@/config/cdn';

const OGABASSEY_CDN_HOSTNAME = new URL(DEFAULT_MEDIA_CDN_ORIGIN).hostname;
const OGABASSEY_IMAGE_TRANSFORM_PREFIX = '/image/';
const OGABASSEY_SAME_ORIGIN_IMAGE_TRANSFORM_PREFIX = '/cdn-image/';

/**
 * Rewrites an OgaBassey CDN transform URL (`https://cdn.ogabassey.com/image/...`)
 * to its same-origin `/cdn-image/...` path so homepage hero `<link rel="preload">`,
 * `<source srcset>`, and `<img src>` avoid a cross-origin DNS/TCP/TLS handshake on
 * Slow-4G while preserving non-CDN and data URLs unchanged.
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
  return `${OGABASSEY_SAME_ORIGIN_IMAGE_TRANSFORM_PREFIX}${remainder}${parsed.search}${parsed.hash}`;
}
