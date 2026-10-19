import { getImageProps } from 'next/image';
import {
  MOBILE_HERO_IMAGE_HEIGHT,
  MOBILE_HERO_IMAGE_QUALITY,
  MOBILE_HERO_IMAGE_SIZES,
  MOBILE_HERO_IMAGE_WIDTH,
} from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import { ogabasseyFallbackImageLoader } from '@/lib/ogabassey-image-fallback-loader';

// Control-hero hint derivation. The original MobileLcpHeroImage renders its
// slide-0 srcSet through getImageProps with the args below; the lab control
// arm must preload EXACTLY that srcSet or discovery timing differs from the
// pilot arm (and from production, which ships a matched committed hint).
// This mirrors MobileLcpHeroImage's getImageProps call argument-for-argument.
export function deriveControlHeroHint(input: {
  alt: string;
  stagedOriginalUrl: string;
}): { href: string; imageSizes: string; imageSrcSet: string } {
  const {
    props: { sizes, src, srcSet },
  } = getImageProps({
    alt: input.alt,
    decoding: 'sync',
    fetchPriority: 'high',
    height: MOBILE_HERO_IMAGE_HEIGHT,
    loader: ogabasseyFallbackImageLoader,
    loading: 'eager',
    quality: MOBILE_HERO_IMAGE_QUALITY,
    sizes: MOBILE_HERO_IMAGE_SIZES,
    src: input.stagedOriginalUrl,
    width: MOBILE_HERO_IMAGE_WIDTH,
  });
  return {
    href: src,
    imageSizes: sizes ?? MOBILE_HERO_IMAGE_SIZES,
    imageSrcSet: srcSet ?? src,
  };
}
