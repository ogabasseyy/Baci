import { getImageProps } from 'next/image';
import { rewriteOgabasseyTransformUrlFormat } from '@/lib/ogabassey-cdn-image-url';
import { ogabasseyFallbackImageLoader } from '@/lib/ogabassey-image-fallback-loader';
import { buildOgabasseyAvifSrcSet } from '@/lib/ogabassey-image-format-sources';
import {
  MOBILE_HERO_IMAGE_HEIGHT,
  MOBILE_HERO_IMAGE_QUALITY,
  MOBILE_HERO_IMAGE_SIZES,
  MOBILE_HERO_IMAGE_WIDTH,
  MOBILE_HERO_MAX_SRCSET_WIDTH,
  MOBILE_HERO_MIN_SRCSET_WIDTH,
  MOBILE_HERO_SOURCE_MEDIA,
} from './hero-mobile-image-config';

const MAX_INLINE_SOURCE_SRCSET_CHARS = 360;
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

interface ParsedSrcSetCandidate {
  raw: string;
  width: number | null;
}

function parseSrcSetCandidate(candidate: string): ParsedSrcSetCandidate {
  const trimmed = candidate.trim();
  const match = trimmed.match(/\s+(\d+)w$/i);
  return {
    raw: trimmed,
    width: match ? Number.parseInt(match[1], 10) : null,
  };
}

function getResponsiveSizes(srcSetValue: string, sizesValue?: string) {
  return WIDTH_DESCRIPTOR_PATTERN.test(srcSetValue) ? sizesValue : undefined;
}

/**
 * Cap responsive `srcSet` width rungs so hero `<picture>` elements never
 * advertise oversized desktop variants or exceed React 19 Fizz's 500-byte
 * inline `<Suspense>` boundary budget.
 */
export function capSrcSetWidthRungs(
  srcSet: string | undefined,
  maxWidth: number,
  minWidth = 0,
  maxRungs = 2
): string | undefined {
  if (!srcSet) {
    return srcSet;
  }

  const candidates = srcSet
    .split(/,\s+/)
    .map(parseSrcSetCandidate)
    .filter((entry) => entry.raw.length > 0);
  if (
    candidates.length === 0 ||
    candidates.every((entry) => entry.width === null)
  ) {
    return srcSet;
  }

  const underMax = candidates.filter(
    (entry) => entry.width === null || entry.width <= maxWidth
  );
  const boundedMax = underMax.length > 0 ? underMax : [candidates[0]];
  const aboveMin = boundedMax.filter(
    (entry) => entry.width === null || entry.width >= minWidth
  );
  const bounded = aboveMin.length > 0 ? aboveMin : boundedMax;

  const selected =
    bounded.length > maxRungs && maxRungs >= 2
      ? [bounded[0], bounded[bounded.length - 1]]
      : bounded.slice(0, Math.max(1, maxRungs));

  const joined = selected.map((entry) => entry.raw).join(', ');
  if (joined.length > MAX_INLINE_SOURCE_SRCSET_CHARS && selected.length > 1) {
    return selected[selected.length - 1].raw;
  }

  return joined;
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

  const fallbackSrc = ogabasseyFallbackImageLoader({
    quality: MOBILE_HERO_IMAGE_QUALITY,
    src: imageUrl,
    width: MOBILE_HERO_IMAGE_WIDTH,
  });
  const cappedSrcSet = capSrcSetWidthRungs(
    rawSrcSet,
    MOBILE_HERO_MAX_SRCSET_WIDTH,
    MOBILE_HERO_MIN_SRCSET_WIDTH
  );
  const sourceSrcSet = inlineSrc ?? cappedSrcSet ?? fallbackSrc;
  const resolvedSizes = sizes ?? MOBILE_HERO_IMAGE_SIZES;
  const responsiveSizes = getResponsiveSizes(sourceSrcSet, resolvedSizes);
  const srcSet = cappedSrcSet || `${fallbackSrc} ${MOBILE_HERO_IMAGE_WIDTH}w`;
  const avifSrc = rewriteOgabasseyTransformUrlFormat(fallbackSrc, 'avif');
  const avifSrcSet = buildOgabasseyAvifSrcSet(
    inlineSrc ? sourceSrcSet : srcSet
  );

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
