import { getImageProps } from 'next/image';
import { rewriteOgabasseyTransformUrlFormat } from '@/lib/ogabassey-cdn-image-url';
import { ogabasseyFallbackImageLoader } from '@/lib/ogabassey-image-fallback-loader';
import { buildOgabasseyAvifSrcSet } from '@/lib/ogabassey-image-format-sources';
import {
  toOgabasseySameOriginSrcSet,
  toOgabasseySameOriginTransformUrl,
} from '@/lib/ogabassey-same-origin-hero-url';
import {
  capSrcSetWidthRungs,
  MOBILE_HERO_IMAGE_HEIGHT,
  MOBILE_HERO_IMAGE_QUALITY,
  MOBILE_HERO_IMAGE_SIZES,
  MOBILE_HERO_IMAGE_WIDTH,
  MOBILE_HERO_MAX_SRCSET_WIDTH,
  MOBILE_HERO_MIN_SRCSET_WIDTH,
  MOBILE_HERO_SOURCE_MEDIA,
} from './hero-mobile-image-config';

export { capSrcSetWidthRungs };

const WIDTH_DESCRIPTOR_PATTERN = /\s\d+w(?:,|$)/;

export interface OgabasseyHeroLcpSlideSource {
  alt?: string;
  imageUrl?: string | null;
  inlineSrc?: string;
}

export interface OgabasseyHeroLcpImageDescriptor {
  avifSrc: string | null;
  avifSrcSet: string | null;
  height: number;
  imgProps: Omit<
    ReturnType<typeof getImageProps>['props'],
    'sizes' | 'src' | 'srcSet'
  >;
  media: typeof MOBILE_HERO_SOURCE_MEDIA;
  quality: typeof MOBILE_HERO_IMAGE_QUALITY;
  responsiveSizes: string | undefined;
  sizes: string;
  sourceSrcSet: string;
  src: string;
  srcSet: string;
  width: number;
}

function getResponsiveSizes(srcSetValue: string, sizesValue?: string) {
  return WIDTH_DESCRIPTOR_PATTERN.test(srcSetValue) ? sizesValue : undefined;
}

function getLastSrcSetCandidateUrl(
  srcSetValue: string | undefined
): string | null {
  if (!srcSetValue || !WIDTH_DESCRIPTOR_PATTERN.test(srcSetValue)) {
    return null;
  }
  const entries = srcSetValue
    .split(/,\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const lastEntry = entries[entries.length - 1];
  const candidateUrl = lastEntry?.replace(/\s+\d+w$/i, '').trim();
  return candidateUrl || null;
}

export function getOgabasseyHeroLcpImage(
  slideOrSrc: string | OgabasseyHeroLcpSlideSource | null | undefined
): OgabasseyHeroLcpImageDescriptor | null {
  const rawSrc =
    typeof slideOrSrc === 'string' ? slideOrSrc : slideOrSrc?.imageUrl;
  const alt = typeof slideOrSrc === 'string' ? '' : (slideOrSrc?.alt ?? '');
  const inlineSrc =
    typeof slideOrSrc === 'string' ? undefined : slideOrSrc?.inlineSrc;
  const imageUrl = rawSrc?.trim();
  if (!imageUrl) {
    return null;
  }

  const {
    props: { src: _resolvedSrc, srcSet: rawSrcSet, sizes, ...imgProps },
  } = getImageProps({
    alt,
    decoding: 'sync',
    fetchPriority: 'high',
    height: MOBILE_HERO_IMAGE_HEIGHT,
    loader: ogabasseyFallbackImageLoader,
    loading: 'eager',
    quality: MOBILE_HERO_IMAGE_QUALITY,
    sizes: MOBILE_HERO_IMAGE_SIZES,
    src: imageUrl,
    width: MOBILE_HERO_IMAGE_WIDTH,
  });

  const cappedSrcSet = capSrcSetWidthRungs(
    rawSrcSet,
    MOBILE_HERO_MAX_SRCSET_WIDTH,
    MOBILE_HERO_MIN_SRCSET_WIDTH
  );
  const defaultFallbackSrc = ogabasseyFallbackImageLoader({
    quality: MOBILE_HERO_IMAGE_QUALITY,
    src: imageUrl,
    width: MOBILE_HERO_MAX_SRCSET_WIDTH,
  });
  const rawFallbackSrc =
    getLastSrcSetCandidateUrl(cappedSrcSet) ?? defaultFallbackSrc;
  const rawSourceSrcSet = inlineSrc ?? cappedSrcSet ?? rawFallbackSrc;
  const resolvedSizes = sizes ?? MOBILE_HERO_IMAGE_SIZES;
  const responsiveSizes = getResponsiveSizes(rawSourceSrcSet, resolvedSizes);
  const rawFullSrcSet =
    cappedSrcSet || `${rawFallbackSrc} ${MOBILE_HERO_MAX_SRCSET_WIDTH}w`;
  const rawAvifSrc = rewriteOgabasseyTransformUrlFormat(rawFallbackSrc, 'avif');
  const rawAvifSrcSet = buildOgabasseyAvifSrcSet(
    inlineSrc ? rawSourceSrcSet : rawFullSrcSet
  );
  const fallbackSrc = toOgabasseySameOriginTransformUrl(rawFallbackSrc);
  const sourceSrcSet =
    toOgabasseySameOriginSrcSet(rawSourceSrcSet) ?? fallbackSrc;
  const srcSet = toOgabasseySameOriginSrcSet(rawFullSrcSet) ?? fallbackSrc;
  const avifSrc = rawAvifSrc
    ? toOgabasseySameOriginTransformUrl(rawAvifSrc)
    : null;
  const avifSrcSet = toOgabasseySameOriginSrcSet(rawAvifSrcSet) ?? null;

  return {
    avifSrc,
    avifSrcSet,
    height: MOBILE_HERO_IMAGE_HEIGHT,
    imgProps,
    media: MOBILE_HERO_SOURCE_MEDIA,
    quality: MOBILE_HERO_IMAGE_QUALITY,
    responsiveSizes,
    sizes: resolvedSizes,
    sourceSrcSet,
    src: fallbackSrc,
    srcSet,
    width: MOBILE_HERO_IMAGE_WIDTH,
  };
}
