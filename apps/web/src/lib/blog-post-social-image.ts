import { DEFAULT_IMAGE_QUALITY, DEFAULT_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import { getTrustedBlogMediaTransformProjection } from '@/lib/get-trusted-blog-media-transform-projection';
import { isTrustedBlogMediaTransformUrl } from '@/lib/is-trusted-blog-media-transform-url';
import { isTrustedImmutableBlogLandscapeVariantUrl } from '@/lib/is-trusted-immutable-blog-landscape-variant-url';
import {
  buildOgabasseyCdnImageLoaderUrl,
  isOgabasseyCdnImageUrl,
  resolveOgabasseyCdnFallbackFormat,
} from '@/lib/ogabassey-cdn-image-url';

const LANDSCAPE_DIMENSIONS = { width: 1200, height: 675 } as const;
const FALLBACK_DIMENSIONS = { width: 1200, height: 630 } as const;
const MANAGED_CDN_ORIGIN = new URL(DEFAULT_MEDIA_CDN_ORIGIN).origin;

export type BlogPostSocialImage = {
  url: string;
  width?: number;
  height?: number;
  type?: `image/${string}`;
};

function getAbsoluteHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    if (url.username || url.password) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function getImageMimeType(url: string): `image/${string}` | undefined {
  const pathname = getImagePathname(url);
  if (!pathname) return undefined;

  const extension = pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!extension) return undefined;

  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'avif') return 'image/avif';
  return undefined;
}

function getImagePathname(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}

function getPositiveDimension(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getCompatibilityImageUrl(storeUrl: string, postSlug: string): string {
  const baseUrl = storeUrl.endsWith('/') ? storeUrl : `${storeUrl}/`;
  try {
    return new URL(
      `blog/${encodeURIComponent(postSlug)}/opengraph-image`,
      baseUrl
    ).toString();
  } catch {
    return `/blog/${encodeURIComponent(postSlug)}/opengraph-image`;
  }
}

function projectDirectImage(
  sourceUrl: string,
  dimensions?: { width?: number; height?: number }
): BlogPostSocialImage | null {
  const sourceTransform = getTrustedBlogMediaTransformProjection(sourceUrl);
  const mimeType = getImageMimeType(sourceUrl);
  const isLandscape =
    dimensions?.width === LANDSCAPE_DIMENSIONS.width &&
    dimensions.height === LANDSCAPE_DIMENSIONS.height;

  if (isOgabasseyCdnImageUrl(sourceUrl)) {
    if (!isExactManagedCdnOrigin(sourceUrl)) {
      return null;
    }
    const url = buildOgabasseyCdnImageLoaderUrl(
      sourceUrl,
      1200,
      DEFAULT_IMAGE_QUALITY
    );
    const managedTransform = getTrustedBlogMediaTransformProjection(url);
    if (isTrustedBlogMediaTransformUrl(url) && !managedTransform) {
      return null;
    }
    const transformedMimeType =
      managedTransform?.type ??
      (url !== sourceUrl && mimeType
        ? (`image/${resolveOgabasseyCdnFallbackFormat(getImagePathname(sourceUrl) ?? '')}` as const)
        : mimeType);
    if (
      (managedTransform && !managedTransform.type) ||
      !transformedMimeType ||
      transformedMimeType === 'image/avif'
    ) {
      return null;
    }
    const transformedDimensions = managedTransform
      ? getTransformedDimensions(dimensions, managedTransform)
      : isLandscape
        ? LANDSCAPE_DIMENSIONS
        : dimensions;
    return {
      url,
      ...transformedDimensions,
      ...(transformedMimeType ? { type: transformedMimeType } : {}),
    };
  }

  if (isTrustedBlogMediaTransformUrl(sourceUrl) && !sourceTransform) {
    return null;
  }

  if (sourceTransform) {
    if (!sourceTransform.type || sourceTransform.type === 'image/avif') {
      return null;
    }
    const transformedDimensions = getTransformedDimensions(
      dimensions,
      sourceTransform
    );
    return {
      url: sourceUrl,
      ...(transformedDimensions ??
        (isLandscape ? LANDSCAPE_DIMENSIONS : dimensions)),
      type: sourceTransform.type,
    };
  }

  if (!mimeType || mimeType === 'image/avif') {
    return null;
  }

  return {
    url: sourceUrl,
    ...(isLandscape ? LANDSCAPE_DIMENSIONS : dimensions),
    ...(mimeType ? { type: mimeType } : {}),
  };
}

function isExactManagedCdnOrigin(sourceUrl: string): boolean {
  try {
    const url = new URL(sourceUrl);
    return url.protocol === 'https:' && url.origin === MANAGED_CDN_ORIGIN;
  } catch {
    return false;
  }
}

function getTransformedDimensions(
  dimensions?: {
    width?: number;
    height?: number;
  },
  transform: {
    fit: 'cover' | 'inside';
    height?: number;
    width?: number;
  } = { fit: 'inside', width: LANDSCAPE_DIMENSIONS.width }
): { width: number; height: number } | undefined {
  const width = getPositiveDimension(dimensions?.width);
  const height = getPositiveDimension(dimensions?.height);
  if (width === undefined || height === undefined) return undefined;
  const requestedWidth = getPositiveDimension(transform.width);
  const requestedHeight = getPositiveDimension(transform.height);
  if (requestedWidth === undefined && requestedHeight === undefined) {
    return { width, height };
  }

  const widthScale = requestedWidth === undefined ? 1 : requestedWidth / width;
  const heightScale =
    requestedHeight === undefined ? 1 : requestedHeight / height;
  const constrainedScale =
    transform.fit === 'cover' &&
    requestedWidth !== undefined &&
    requestedHeight !== undefined
      ? Math.max(widthScale, heightScale)
      : Math.min(widthScale, heightScale);
  const scale = Math.min(1, constrainedScale);
  const scaledWidth = Math.round(width * scale);
  const scaledHeight = Math.round(height * scale);

  return transform.fit === 'cover' &&
    requestedWidth !== undefined &&
    requestedHeight !== undefined
    ? {
        width: Math.min(requestedWidth, scaledWidth),
        height: Math.min(requestedHeight, scaledHeight),
      }
    : { width: scaledWidth, height: scaledHeight };
}

/**
 * Projects cached blog-post media into direct social metadata. Transformable
 * OgaBassey assets are pinned to JPEG/PNG; immutable uploaded variants under
 * /media keep their explicit native format. Unrecognized HTTP(S) assets use
 * the compatibility route so social metadata never advertises a non-image.
 */
export function getBlogPostSocialImage(
  storeUrl: string,
  postSlug: string,
  featuredImageUrl: unknown,
  featuredImageVariants: unknown,
  featuredImageWidth?: unknown,
  featuredImageHeight?: unknown
): BlogPostSocialImage {
  const variants = isRecord(featuredImageVariants) ? featuredImageVariants : {};
  const landscapeUrl = getAbsoluteHttpUrl(variants.landscape_16x9);
  const originalUrl = getAbsoluteHttpUrl(featuredImageUrl);

  if (landscapeUrl && isTrustedImmutableBlogLandscapeVariantUrl(landscapeUrl)) {
    const directImage = projectDirectImage(landscapeUrl, LANDSCAPE_DIMENSIONS);
    if (directImage) {
      return directImage;
    }
  }

  if (originalUrl) {
    const width = getPositiveDimension(featuredImageWidth);
    const height = getPositiveDimension(featuredImageHeight);
    const directImage = projectDirectImage(
      originalUrl,
      width !== undefined && height !== undefined
        ? { width, height }
        : undefined
    );
    if (directImage) {
      return directImage;
    }
  }

  return {
    url: getCompatibilityImageUrl(storeUrl, postSlug),
    ...FALLBACK_DIMENSIONS,
    type: 'image/png',
  };
}
