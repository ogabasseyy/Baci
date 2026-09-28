import { getImageProps } from 'next/image';
import type { OgabasseyHomeHeroSnapshot } from '@/lib/ogabassey-home-hero-snapshot-types';
import { ogabasseyFallbackImageLoader } from '@/lib/ogabassey-image-fallback-loader';
import { buildOgabasseyAvifSrcSet } from '@/lib/ogabassey-image-format-sources';
import {
  MOBILE_HERO_IMAGE_HEIGHT,
  MOBILE_HERO_IMAGE_SIZES,
  MOBILE_HERO_IMAGE_WIDTH,
  MOBILE_HERO_SOURCE_MEDIA,
  MOBILE_HERO_IMAGE_QUALITY,
  TRANSPARENT_PIXEL_SRC,
} from './hero-mobile-image-config';

interface MobileLcpHeroImageProps {
  alt: string;
  imageFit?: 'contain' | 'cover';
  inlineSrc?: string;
  shouldPrioritizeImage: boolean;
  /** Same-origin AVIF snapshot for `src`, resolved server-side. Only the
   *  AVIF `<source>` tier swaps to it (and only when its `sourceUrl` exactly
   *  equals `src`); the fallback `<source>` and `<img>` stay on the CDN
   *  bytes so non-AVIF browsers render exactly as before. */
  snapshot?: OgabasseyHomeHeroSnapshot | null;
  src: string;
}

const WIDTH_DESCRIPTOR_PATTERN = /\s\d+w(?:,|$)/;

function getResponsiveSizes(srcSetValue: string, sizesValue?: string) {
  return WIDTH_DESCRIPTOR_PATTERN.test(srcSetValue) ? sizesValue : undefined;
}

export function MobileLcpHeroImage({
  alt,
  imageFit,
  inlineSrc,
  shouldPrioritizeImage,
  snapshot,
  src,
}: MobileLcpHeroImageProps) {
  const {
    props: { src: productSrc, srcSet, sizes, ...imgProps },
  } = getImageProps({
    alt,
    decoding: 'sync',
    fetchPriority: 'high',
    height: MOBILE_HERO_IMAGE_HEIGHT,
    loader: ogabasseyFallbackImageLoader,
    loading: 'eager',
    quality: MOBILE_HERO_IMAGE_QUALITY,
    sizes: MOBILE_HERO_IMAGE_SIZES,
    src,
    width: MOBILE_HERO_IMAGE_WIDTH,
  });
  const productSrcSet = inlineSrc ?? srcSet ?? productSrc;
  const productSizes = getResponsiveSizes(
    productSrcSet,
    sizes ?? MOBILE_HERO_IMAGE_SIZES
  );
  // Explicit `format=avif` twin of the fallback srcSet. Cloudflare Free ignores
  // `Vary: Accept`, so per-format URLs (not one `format=auto` body) are the only
  // way AVIF-capable browsers get AVIF while others get the decodable fallback.
  // `null` when the source is not an OgaBassey transform URL (external image) —
  // the plain `<source>` then serves everyone.
  //
  // A same-origin snapshot replaces this tier only, and only when it was
  // baked from this exact `src` (last-mile rotation guard). The snapshot
  // srcSet carries the same width descriptors and quality the CDN AVIF tier
  // would, so responsive selection is unchanged — only the origin differs.
  const snapshotSrcSet =
    snapshot && snapshot.sourceUrl === src.trim() && snapshot.srcSet
      ? snapshot.srcSet
      : null;
  const avifSrcSet = snapshotSrcSet ?? buildOgabasseyAvifSrcSet(productSrcSet);

  return (
    <picture className="block h-full w-full">
      {avifSrcSet ? (
        <source
          media={MOBILE_HERO_SOURCE_MEDIA}
          sizes={productSizes}
          srcSet={avifSrcSet}
          type="image/avif"
        />
      ) : null}
      <source
        media={MOBILE_HERO_SOURCE_MEDIA}
        sizes={productSizes}
        srcSet={productSrcSet}
      />
      <img
        {...imgProps}
        alt={alt}
        fetchPriority={shouldPrioritizeImage ? 'high' : undefined}
        src={TRANSPARENT_PIXEL_SRC}
        className={`h-full w-full ${
          imageFit === 'contain' ? 'object-contain object-right' : 'object-cover'
        }`}
      />
    </picture>
  );
}
