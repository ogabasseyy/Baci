import { TRANSPARENT_PIXEL_SRC } from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import type { ApprovedPilotTier } from './lab-index';
import { buildPilotSrcSet, pilotTierUrl } from './responsive-projection';

export interface OgabasseyMobileSlot {
  alt: string;
  // Object-fit of the mounted renderer (MobileLcpHeroImage imageFit):
  // contain renders object-contain object-right, cover renders object-cover.
  imageFit: 'contain' | 'cover';
  media: string;
  sizes: string;
}

export interface ProjectedOgabasseyMobile {
  alt: string;
  avifSrcSet: string;
  fallbackSrcSet: string;
  imageFit: 'contain' | 'cover';
  imgSrc: string;
  media: string;
  preload: {
    fetchPriority: 'high';
    href: string;
    imageSizes: string;
    imageSrcSet: string;
    media: string;
    type: 'image/avif';
  };
  sizes: string;
}

export function projectPilotOgabasseyMobile(input: {
  baseUrl: string;
  slot: OgabasseyMobileSlot;
  tiers: readonly ApprovedPilotTier[];
}): ProjectedOgabasseyMobile | null {
  const avifSrcSet = buildPilotSrcSet({
    baseUrl: input.baseUrl,
    format: 'avif',
    tiers: input.tiers,
  });
  const fallbackSrcSet = buildPilotSrcSet({
    baseUrl: input.baseUrl,
    format: 'webp',
    tiers: input.tiers,
  });
  if (!avifSrcSet || !fallbackSrcSet) {
    return null;
  }
  const smallestAvif = [...input.tiers]
    .filter((tier) => tier.format === 'avif')
    .sort((left, right) => left.width - right.width)[0];
  if (!smallestAvif) {
    return null;
  }
  // One projection feeds the rendered <picture> and every hint owner
  // (committed slot, scanner link, flight preload): the AVIF preload is
  // byte-identical to the rendered AVIF source, so preload matching dedupes
  // them into one fetch. WebP is discovered from the fallback <source> by
  // non-AVIF browsers; preloading both formats would double-fetch.
  return {
    alt: input.slot.alt,
    avifSrcSet,
    fallbackSrcSet,
    imageFit: input.slot.imageFit,
    imgSrc: TRANSPARENT_PIXEL_SRC,
    media: input.slot.media,
    preload: {
      fetchPriority: 'high',
      href: pilotTierUrl({ baseUrl: input.baseUrl, tier: smallestAvif }),
      imageSizes: input.slot.sizes,
      imageSrcSet: avifSrcSet,
      media: input.slot.media,
      type: 'image/avif',
    },
    sizes: input.slot.sizes,
  };
}

export function projectControlOgabasseyMobile(input: {
  originalUrl: string;
  slot: OgabasseyMobileSlot;
}): ProjectedOgabasseyMobile {
  return {
    alt: input.slot.alt,
    avifSrcSet: input.originalUrl,
    fallbackSrcSet: input.originalUrl,
    imageFit: input.slot.imageFit,
    imgSrc: TRANSPARENT_PIXEL_SRC,
    media: input.slot.media,
    preload: {
      fetchPriority: 'high',
      href: input.originalUrl,
      imageSizes: input.slot.sizes,
      imageSrcSet: input.originalUrl,
      media: input.slot.media,
      type: 'image/avif',
    },
    sizes: input.slot.sizes,
  };
}
