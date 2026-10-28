import { Suspense } from 'react';
import { getOgabasseyHeroLcpImage } from './hero-lcp-image-descriptor';
import {
  DESKTOP_HERO_SOURCE_MEDIA,
  TRANSPARENT_PIXEL_SRC,
} from './hero-mobile-image-config';

interface MobileLcpHeroImageProps {
  alt: string;
  imageFit?: 'contain' | 'cover';
  inlineSrc?: string;
  shouldPrioritizeImage: boolean;
  src: string;
}

export function MobileLcpHeroImage({
  alt,
  imageFit,
  inlineSrc,
  shouldPrioritizeImage,
  src,
}: MobileLcpHeroImageProps) {
  const descriptor = getOgabasseyHeroLcpImage({
    alt,
    imageUrl: src,
    inlineSrc,
  });
  if (!descriptor) {
    return null;
  }

  const {
    avifSrcSet,
    imgProps,
    media,
    responsiveSizes,
    sourceSrcSet,
    src: productSrc,
  } = descriptor;

  return (
    <picture className="block h-full w-full">
      {avifSrcSet ? (
        <Suspense fallback={null}>
          <source
            media={media}
            sizes={responsiveSizes}
            srcSet={avifSrcSet}
            type="image/avif"
          />
        </Suspense>
      ) : null}
      <Suspense fallback={null}>
        <source
          media={media}
          sizes={responsiveSizes}
          srcSet={sourceSrcSet}
        />
      </Suspense>
      <Suspense fallback={null}>
        <source
          media={DESKTOP_HERO_SOURCE_MEDIA}
          srcSet={TRANSPARENT_PIXEL_SRC}
        />
      </Suspense>
      <img
        {...imgProps}
        alt={alt}
        fetchPriority={shouldPrioritizeImage ? 'high' : undefined}
        sizes={responsiveSizes}
        src={productSrc}
        className={`h-full w-full ${
          imageFit === 'contain' ? 'object-contain object-right' : 'object-cover'
        }`}
      />
    </picture>
  );
}
