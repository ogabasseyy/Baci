import { getImageProps } from 'next/image';
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
  const avifSrcSet = buildOgabasseyAvifSrcSet(productSrcSet);

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
