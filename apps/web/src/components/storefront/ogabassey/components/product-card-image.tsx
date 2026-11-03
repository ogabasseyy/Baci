import { getProductImageAlt } from '@baci/shared/lib/product-image-alt';
import { trimString } from '@baci/shared/lib/string-values';
import type React from 'react';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import { PLACEHOLDER_IMAGE } from '@/lib/image-utils';
import type { Product } from '../types';

export interface ProductCardImageProps {
  className: string;
  imagePriority?: boolean;
  product: Product;
  sizes: string;
}

/**
 * Renders the storefront product card image with CDN format negotiation and
 * configurable first-row image priority (`eager` + `fetchPriority="high"`).
 */
export const ProductCardImage: React.FC<ProductCardImageProps> = ({
  className,
  imagePriority = false,
  product,
  sizes,
}) => {
  const productImageUrl = trimString(product.image);
  const productImageSrc = productImageUrl || PLACEHOLDER_IMAGE;
  const productImageAlt = productImageUrl
    ? getProductImageAlt(product, {
        renderedImageUrl: productImageUrl,
      })
    : '';

  return (
    <CdnFormatImage
      src={productImageSrc}
      alt={productImageAlt}
      fill
      sizes={sizes}
      loading={imagePriority ? 'eager' : 'lazy'}
      fetchPriority={imagePriority ? 'high' : 'auto'}
      className={className}
    />
  );
};
