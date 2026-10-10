import { useState } from 'react';
import {
  getProductCardImageAttempt,
  normalizeProductImages,
} from '@/lib/product-normalization';

interface ProductCardImageSource {
  image?: string | null;
  images?: string[] | null;
  id: string;
}

// Owns card image fallback: walks the candidate list on errors, then falls
// back to a local placeholder. FlashList recycles card instances, so the
// attempt state resets when the product (its image set) changes — otherwise
// a recycled card would show the previous product's placeholder/attempt.
// (Render-time adjustment, not an effect, so it lands before paint.)
export function useProductCardImage(
  product: ProductCardImageSource,
  blurhash: string
) {
  const imageCandidates = normalizeProductImages(
    product.image
      ? [
          product.image,
          ...(Array.isArray(product.images) ? product.images : []),
        ]
      : product.images
  );
  const imageCandidatesKey = imageCandidates.join('|');
  const [imageAttempt, setImageAttempt] = useState(0);
  const [showLocalPlaceholder, setShowLocalPlaceholder] = useState(false);

  const [prevImageCandidatesKey, setPrevImageCandidatesKey] =
    useState(imageCandidatesKey);
  if (prevImageCandidatesKey !== imageCandidatesKey) {
    setPrevImageCandidatesKey(imageCandidatesKey);
    setImageAttempt(0);
    setShowLocalPlaceholder(false);
  }

  const imageProps = {
    placeholder: { blurhash },
    transition: 300,
    cachePolicy: 'memory-disk' as const,
    contentFit: 'cover' as const,
    recyclingKey: product.id,
    allowDownscaling: true,
    enforceEarlyResizing: true,
    autoplay: false,
    onError: () => {
      if (imageAttempt < imageCandidates.length) {
        setImageAttempt((current) => current + 1);
        return;
      }

      setShowLocalPlaceholder(true);
    },
  };

  const imageAttemptUri = getProductCardImageAttempt(
    imageCandidates,
    imageAttempt
  );
  return { imageAttemptUri, imageProps, showLocalPlaceholder };
}
