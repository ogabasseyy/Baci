import { clampImageDecodeDimension } from './image-decode-dimensions';

interface ImageDimensions {
  height?: number;
  fit?: 'inside' | 'cover';
  width?: number;
}

const OGABASSEY_CDN_HOSTNAME = 'cdn.ogabassey.com';
const OGABASSEY_IMAGE_TRANSFORM_PREFIX = '/image/';
const OGABASSEY_PRODUCT_PATH_PREFIX = '/core-assets/products/';
const OGABASSEY_LEGACY_PRODUCT_PATH_PREFIX = '/products/';
const TRANSFORMABLE_EXTENSION = /\.(avif|jpe?g|png|webp)$/i;
const MIN_TRANSFORM_DIMENSION = 16;
const DEFAULT_TRANSFORM_QUALITY = 82;
const DEFAULT_TRANSFORM_FORMAT = 'webp';
const STATIC_WEBP_SOURCE_FORMAT = 'jpeg';

/**
 * Resolve a managed product image to a bounded, static fallback format.
 *
 * The storefront receives product assets from the OgaBassey CDN in a number
 * of formats, including AVIF. Android's AVIF frame decoder allocates an
 * additional ARGB bitmap for each frame; on low-memory devices this has been
 * observed to crash in FrameAnimationDrawable even when autoplay is disabled.
 * Managed AVIF (and other catalog) assets are therefore transcoded at the
 * requested decode size. PNG, JPEG, and AVIF inputs use WebP, which avoids the
 * animated AVIF decoder and retains PNG alpha channels. WebP inputs use JPEG
 * so the transformer decodes only the first frame instead of preserving a
 * potentially animated source. URLs from other hosts—including signed or
 * transformed Supabase URLs—are returned unchanged.
 */
export function resolveSafeImageUri(
  uri: string,
  dimensions: ImageDimensions = {}
) {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return uri;
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== OGABASSEY_CDN_HOSTNAME
  ) {
    return uri;
  }

  const sourcePath = getManagedProductPath(parsed.pathname);
  if (!sourcePath) {
    return uri;
  }

  const options = [
    toTransformDimension(dimensions.width, 'width'),
    toTransformDimension(dimensions.height, 'height'),
    `quality=${DEFAULT_TRANSFORM_QUALITY}`,
    `format=${getTransformFormat(sourcePath)}`,
    dimensions.fit === 'cover' ? 'fit=cover' : undefined,
  ].filter((option): option is string => Boolean(option));

  return `${parsed.origin}${OGABASSEY_IMAGE_TRANSFORM_PREFIX}${options.join(',')}${sourcePath}${parsed.search}${parsed.hash}`;
}

function getTransformFormat(sourcePath: string) {
  return /\.webp$/i.test(sourcePath)
    ? STATIC_WEBP_SOURCE_FORMAT
    : DEFAULT_TRANSFORM_FORMAT;
}

function getManagedProductPath(pathname: string) {
  const normalizedPath = pathname.replace(/\/{2,}/g, '/');
  const unwrappedPath = normalizedPath.startsWith(
    OGABASSEY_IMAGE_TRANSFORM_PREFIX
  )
    ? unwrapTransformPath(normalizedPath)
    : normalizedPath;

  if (!unwrappedPath || !TRANSFORMABLE_EXTENSION.test(unwrappedPath)) {
    return null;
  }

  if (unwrappedPath.startsWith(OGABASSEY_PRODUCT_PATH_PREFIX)) {
    return unwrappedPath;
  }

  if (unwrappedPath.startsWith(OGABASSEY_LEGACY_PRODUCT_PATH_PREFIX)) {
    return `${OGABASSEY_PRODUCT_PATH_PREFIX}${unwrappedPath.slice(OGABASSEY_LEGACY_PRODUCT_PATH_PREFIX.length)}`;
  }

  return null;
}

function unwrapTransformPath(pathname: string) {
  const rest = pathname.slice(OGABASSEY_IMAGE_TRANSFORM_PREFIX.length);
  const separatorIndex = rest.indexOf('/');
  return separatorIndex > 0 ? rest.slice(separatorIndex) : null;
}

function toTransformDimension(value: number | undefined, key: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const dimension = Math.round(value);
  if (dimension < MIN_TRANSFORM_DIMENSION) {
    return undefined;
  }

  return `${key}=${clampImageDecodeDimension(dimension)}`;
}
