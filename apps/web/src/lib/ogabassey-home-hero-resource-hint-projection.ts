import { createHash } from 'node:crypto';
import 'server-only';
import { getOgabasseyImagePreloadType } from '@/app/(storefront)/ogabassey/ogabassey-image-preload-type';
import {
  getOgabasseyHeroLcpImage,
  type OgabasseyHeroLcpImageDescriptor,
  type OgabasseyHeroLcpSlideSource,
} from '@/components/storefront/ogabassey/components/hero-lcp-image-descriptor';
import type {
  MOBILE_HERO_IMAGE_QUALITY,
  MOBILE_HERO_SOURCE_MEDIA,
} from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import { isOgabasseyCdnImageUrl } from '@/lib/ogabassey-cdn-image-url';

export {
  getOgabasseyHeroLcpImage,
  type OgabasseyHeroLcpImageDescriptor,
  type OgabasseyHeroLcpSlideSource,
};

export interface OgabasseyHomeHeroResourceHintIdentity {
  as: 'image';
  digest: string;
  fetchPriority: 'high';
  href: string;
  imageSizes: string;
  imageSrcSet: string;
  imageUrl: string;
  media: typeof MOBILE_HERO_SOURCE_MEDIA;
  quality: typeof MOBILE_HERO_IMAGE_QUALITY;
  type: string | undefined;
  version: 1;
}

type ResourceHintIdentityWithoutDigest = Omit<
  OgabasseyHomeHeroResourceHintIdentity,
  'digest'
>;

function canonicalIdentity(
  projection: ResourceHintIdentityWithoutDigest
): string {
  return JSON.stringify({
    as: projection.as,
    fetchPriority: projection.fetchPriority,
    href: projection.href,
    imageSizes: projection.imageSizes,
    imageSrcSet: projection.imageSrcSet,
    imageUrl: projection.imageUrl,
    media: projection.media,
    quality: projection.quality,
    type: projection.type ?? null,
    version: projection.version,
  });
}

function buildProjectionUnsafe(
  source: string | null | undefined
): OgabasseyHomeHeroResourceHintIdentity | null {
  const imageUrl = source?.trim();
  if (!imageUrl || !isOgabasseyCdnImageUrl(imageUrl)) {
    return null;
  }

  const descriptor = getOgabasseyHeroLcpImage(imageUrl);
  if (!descriptor) {
    return null;
  }

  const {
    avifSrc: avifHref,
    avifSrcSet,
    media,
    quality,
    sizes: imageSizes,
    src: fallbackHref,
    srcSet: fallbackSrcSet,
  } = descriptor;
  const projection: ResourceHintIdentityWithoutDigest = {
    as: 'image',
    fetchPriority: 'high',
    href: avifHref && avifSrcSet ? avifHref : fallbackHref,
    imageSizes,
    imageSrcSet: avifHref && avifSrcSet ? avifSrcSet : fallbackSrcSet,
    imageUrl,
    media,
    quality,
    type:
      avifHref && avifSrcSet
        ? 'image/avif'
        : getOgabasseyImagePreloadType(fallbackHref),
    version: 1,
  };

  return {
    ...projection,
    digest: createHash('sha256')
      .update(canonicalIdentity(projection))
      .digest('hex'),
  };
}

function buildProjection(
  source: string | null | undefined
): OgabasseyHomeHeroResourceHintIdentity | null {
  try {
    return buildProjectionUnsafe(source);
  } catch {
    return null;
  }
}

/** Pure source of truth for the homepage slide-zero preload identity. */
export const ogabasseyHomeHeroResourceHintProjection = {
  build: buildProjection,
  validate(
    projection: unknown
  ): projection is OgabasseyHomeHeroResourceHintIdentity {
    try {
      if (
        !projection ||
        typeof projection !== 'object' ||
        !('imageUrl' in projection) ||
        typeof projection.imageUrl !== 'string'
      ) {
        return false;
      }
      const expected = buildProjection(projection.imageUrl);
      if (!expected) {
        return false;
      }
      return (
        'as' in projection &&
        projection.as === expected.as &&
        'digest' in projection &&
        projection.digest === expected.digest &&
        'fetchPriority' in projection &&
        projection.fetchPriority === expected.fetchPriority &&
        'href' in projection &&
        projection.href === expected.href &&
        'imageSizes' in projection &&
        projection.imageSizes === expected.imageSizes &&
        'imageSrcSet' in projection &&
        projection.imageSrcSet === expected.imageSrcSet &&
        projection.imageUrl === expected.imageUrl &&
        'media' in projection &&
        projection.media === expected.media &&
        'quality' in projection &&
        projection.quality === expected.quality &&
        'type' in projection &&
        projection.type === expected.type &&
        'version' in projection &&
        projection.version === expected.version
      );
    } catch {
      return false;
    }
  },
} as const;
