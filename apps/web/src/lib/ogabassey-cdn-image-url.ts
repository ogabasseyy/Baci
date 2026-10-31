import { DEFAULT_MEDIA_CDN_ORIGIN } from '@/config/cdn';

const OGABASSEY_CDN_HOSTNAME = new URL(DEFAULT_MEDIA_CDN_ORIGIN).hostname;
const OGABASSEY_IMAGE_TRANSFORM_PREFIX = '/image/';
const OGABASSEY_SAME_ORIGIN_IMAGE_TRANSFORM_PREFIX = '/cdn-image/';
const OGABASSEY_PRODUCT_IMAGE_PATH_PREFIX = '/core-assets/products/';
const OGABASSEY_LEGACY_PRODUCT_IMAGE_PATH_PREFIX = '/products/';
const TRANSFORMABLE_IMAGE_EXTENSION_PATTERN = /\.(avif|jpe?g|png|webp)$/i;
const TRANSFORM_FORMAT_TOKEN_PATTERN =
  /(^|,)(format=)(auto|avif|jpe?g|png|webp)(?=,|$)/i;
const TRANSFORM_FORMAT_TOKEN_REPLACE_PATTERN =
  /(^|,)(format=)(auto|avif|jpe?g|png|webp)(?=,|$)/gi;

/**
 * Formats the CDN transformer accepts in the URL options segment
 * (infra/cdn-transformer/request-parser.mjs). `auto` negotiates on the Accept
 * header, but Cloudflare Free stores one body per URL and ignores
 * `Vary: Accept`, so a warm `format=auto` entry can hand non-AVIF browsers
 * undecodable AVIF bytes. As of PR-IMG-2c NO browser-facing URL emits `auto`:
 * the loader default is the universally decodable jpeg/png fallback and every
 * `<picture>` surface passes explicit tiers. `auto` now survives ONLY in the
 * prewarm/backfill transition, which purges/re-warms the legacy `auto` keys
 * still referenced by cached HTML and browser caches.
 */
export type OgabasseyCdnImageFormat = 'auto' | 'avif' | 'jpeg' | 'png' | 'webp';

/**
 * The universally decodable format for a source asset — the `<img>` fallback
 * tier. Mirrors the transformer's own `format=auto` outcome for clients with
 * no modern-format support (`pickFormat` in
 * infra/cdn-transformer/request-parser.mjs): PNG sources stay PNG (preserves
 * transparency), everything else transcodes to JPEG.
 */
export function resolveOgabasseyCdnFallbackFormat(
  pathname: string
): 'jpeg' | 'png' {
  return /\.png$/i.test(pathname) ? 'png' : 'jpeg';
}

export function isOgabasseyCdnImageUrl(src: string): boolean {
  try {
    return new URL(src).hostname === OGABASSEY_CDN_HOSTNAME;
  } catch {
    return false;
  }
}

export function normalizeOgabasseyCdnImageUrl(src: string): string {
  const unwrapped = unwrapOgabasseyTransformUrl(src);
  if (unwrapped) {
    return normalizeOgabasseyLegacyProductImageUrl(unwrapped) ?? unwrapped;
  }

  return normalizeOgabasseyLegacyProductImageUrl(src) ?? src;
}

/**
 * Build the CDN transform URL production emits for managed assets. When no
 * explicit `format` is passed the default is now the universally decodable
 * jpeg/png fallback tier (`resolveOgabasseyCdnFallbackFormat`) — NOT
 * `format=auto`. Cloudflare Free ignores `Vary: Accept`, so a browser-facing
 * `auto` URL can serve AVIF bytes to non-AVIF clients; defaulting to the
 * fallback guarantees any unmigrated `next/image` caller reaching this builder
 * emits bytes every browser can decode. AVIF-capable surfaces opt back into
 * AVIF explicitly via `<picture>` (`format=avif` `<source>` +
 * `buildOgabasseyCdnFallbackImageLoaderUrl` `<img>`). Prewarm/backfill pass
 * `format: 'auto'` explicitly to keep purging/re-warming the legacy keys during
 * the transition.
 */
export function buildOgabasseyCdnImageLoaderUrl(
  src: string,
  width: number,
  quality: number,
  format?: OgabasseyCdnImageFormat
): string {
  const normalizedSrc = normalizeOgabasseyCdnImageUrl(src);
  let url: URL;

  try {
    url = new URL(normalizedSrc);
  } catch {
    return normalizedSrc;
  }

  if (
    url.hostname !== OGABASSEY_CDN_HOSTNAME ||
    !isTransformableOgabasseyAssetPath(url.pathname)
  ) {
    return normalizedSrc;
  }

  const resolvedFormat =
    format ?? resolveOgabasseyCdnFallbackFormat(url.pathname);

  return `${url.origin}${OGABASSEY_IMAGE_TRANSFORM_PREFIX}width=${width},quality=${quality},format=${resolvedFormat}${url.pathname}${url.search}${url.hash}`;
}

/**
 * Build the universally decodable `<img>` fallback tier for explicit
 * per-format `<picture>` rendering. PNG sources stay PNG to preserve
 * transparency; all other managed images fall back to JPEG.
 */
export function buildOgabasseyCdnFallbackImageLoaderUrl(
  src: string,
  width: number,
  quality: number
): string {
  const normalizedSrc = normalizeOgabasseyCdnImageUrl(src);
  let url: URL;

  try {
    url = new URL(normalizedSrc);
  } catch {
    return normalizedSrc;
  }

  if (
    url.hostname !== OGABASSEY_CDN_HOSTNAME ||
    !isTransformableOgabasseyAssetPath(url.pathname)
  ) {
    return normalizedSrc;
  }

  return buildOgabasseyCdnImageLoaderUrl(
    normalizedSrc,
    width,
    quality,
    resolveOgabasseyCdnFallbackFormat(url.pathname)
  );
}

/**
 * Rewrite the `format=` token of an ALREADY-BUILT OgaBassey transform URL to
 * another format tier. Returns `null` when `url` is not an OgaBassey
 * transform URL carrying a format token — callers treat that as "no
 * alternate tier exists" and skip emitting one.
 *
 * Deriving the AVIF tier by rewriting the fallback URL (instead of building
 * it independently) guarantees the two tiers differ ONLY in the format token,
 * so `<source type="image/avif">` and `<img>` candidates — and their preload
 * hints — stay byte-identical apart from the format segment.
 */
export function rewriteOgabasseyTransformUrlFormat(
  url: string,
  format: OgabasseyCdnImageFormat
): string | null {
  if (url.startsWith(OGABASSEY_SAME_ORIGIN_IMAGE_TRANSFORM_PREFIX)) {
    return rewriteSameOriginTransformUrlFormat(url, format);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (
    parsed.hostname !== OGABASSEY_CDN_HOSTNAME ||
    !parsed.pathname.startsWith(OGABASSEY_IMAGE_TRANSFORM_PREFIX)
  ) {
    return null;
  }

  const remainder = parsed.pathname.slice(
    OGABASSEY_IMAGE_TRANSFORM_PREFIX.length
  );
  const separatorIndex = remainder.indexOf('/');
  if (separatorIndex <= 0) {
    return null;
  }

  const optionsSegment = remainder.slice(0, separatorIndex);
  if (!TRANSFORM_FORMAT_TOKEN_PATTERN.test(optionsSegment)) {
    return null;
  }

  const rewrittenOptions = optionsSegment.replace(
    TRANSFORM_FORMAT_TOKEN_REPLACE_PATTERN,
    `$1$2${format}`
  );

  return `${parsed.origin}${OGABASSEY_IMAGE_TRANSFORM_PREFIX}${rewrittenOptions}${remainder.slice(separatorIndex)}${parsed.search}${parsed.hash}`;
}

/**
 * Same-origin `/cdn-image/<options>/<asset>` twin of the absolute rewrite, so
 * hero sources that are already proxy-backed keep their AVIF tier (and the
 * proxy's AVIF byte-cap ladder). `auto` is refused: the proxy only accepts
 * explicit formats.
 */
function rewriteSameOriginTransformUrlFormat(
  url: string,
  format: OgabasseyCdnImageFormat
): string | null {
  if (format === 'auto') {
    return null;
  }
  const remainder = url.slice(
    OGABASSEY_SAME_ORIGIN_IMAGE_TRANSFORM_PREFIX.length
  );
  const separatorIndex = remainder.indexOf('/');
  if (separatorIndex <= 0) {
    return null;
  }
  const optionsSegment = remainder.slice(0, separatorIndex);
  if (!TRANSFORM_FORMAT_TOKEN_PATTERN.test(optionsSegment)) {
    return null;
  }
  const rewrittenOptions = optionsSegment.replace(
    TRANSFORM_FORMAT_TOKEN_REPLACE_PATTERN,
    `$1$2${format}`
  );

  return `${OGABASSEY_SAME_ORIGIN_IMAGE_TRANSFORM_PREFIX}${rewrittenOptions}${remainder.slice(separatorIndex)}`;
}

function isTransformableOgabasseyAssetPath(pathname: string): boolean {
  return (
    (pathname.startsWith(OGABASSEY_PRODUCT_IMAGE_PATH_PREFIX) ||
      pathname.startsWith('/core-assets/blog/')) &&
    TRANSFORMABLE_IMAGE_EXTENSION_PATTERN.test(pathname)
  );
}

function unwrapOgabasseyTransformUrl(src: string): string | null {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }

  if (
    url.hostname !== OGABASSEY_CDN_HOSTNAME ||
    !url.pathname.startsWith(OGABASSEY_IMAGE_TRANSFORM_PREFIX)
  ) {
    return null;
  }

  const remainder = url.pathname.slice(OGABASSEY_IMAGE_TRANSFORM_PREFIX.length);
  const separatorIndex = remainder.indexOf('/');
  if (separatorIndex <= 0) {
    return null;
  }

  const assetPath = remainder.slice(separatorIndex);
  if (!isTransformableOrLegacyOgabasseyAssetPath(assetPath)) {
    return null;
  }

  return `${url.origin}${assetPath}${url.search}${url.hash}`;
}

function isTransformableOrLegacyOgabasseyAssetPath(pathname: string): boolean {
  return (
    isTransformableOgabasseyAssetPath(pathname) ||
    (pathname.startsWith(OGABASSEY_LEGACY_PRODUCT_IMAGE_PATH_PREFIX) &&
      TRANSFORMABLE_IMAGE_EXTENSION_PATTERN.test(pathname))
  );
}

function normalizeOgabasseyLegacyProductImageUrl(src: string): string | null {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }

  if (
    url.hostname !== OGABASSEY_CDN_HOSTNAME ||
    !url.pathname.startsWith(OGABASSEY_LEGACY_PRODUCT_IMAGE_PATH_PREFIX) ||
    !TRANSFORMABLE_IMAGE_EXTENSION_PATTERN.test(url.pathname)
  ) {
    return null;
  }

  const productAssetPath = url.pathname.slice(
    OGABASSEY_LEGACY_PRODUCT_IMAGE_PATH_PREFIX.length
  );
  const normalizedPath = `${OGABASSEY_PRODUCT_IMAGE_PATH_PREFIX}${productAssetPath}`;

  return `${url.origin}${normalizedPath}${url.search}${url.hash}`;
}
