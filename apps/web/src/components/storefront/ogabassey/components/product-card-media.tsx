import type React from 'react';
import { getProductImageAlt } from '@baci/shared/lib/product-image-alt';
import { trimString } from '@baci/shared/lib/string-values';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import { PLACEHOLDER_IMAGE } from '@/lib/image-utils';
import type { Product } from '../types';

/**
 * Safely strips HTML tags from a string using iterative approach
 * to prevent bypass via nested tags like <<script>script>
 */
export function stripHtml(html: string): string {
  if (!html) return '';
  let result = html;
  let prev = '';
  while (result !== prev) {
    prev = result;
    result = result.replace(/<[^>]*>/g, '');
  }
  return result;
}

/**
 * Mirrors ProductRatingRow's normalization: only real, finite, positive
 * ratings earn a star row — never fabricated or degenerate values.
 */
export function hasVisibleRating(
  rating: number | undefined
): rating is number {
  return typeof rating === 'number' && Number.isFinite(rating) && rating > 0;
}

export interface ProductCardBadgeProps {
  className: string;
  product: Product;
}

export const ProductCardBadge: React.FC<ProductCardBadgeProps> = ({
  className,
  product,
}) => {
  const platform = product.variant_attributes?.Platform;
  if (!platform && !product.condition) return null;

  let badgeColor = 'bg-amber-500';
  let badgeText = String(product.condition || '');

  if (platform) {
    badgeText = Array.isArray(platform) ? 'Multi-Platform' : String(platform);
    const lower = badgeText.toLowerCase();
    if (
      lower.includes('playstation') ||
      lower.includes('ps5') ||
      lower.includes('ps4')
    ) {
      badgeColor = 'bg-blue-600';
    } else if (lower.includes('xbox')) {
      badgeColor = 'bg-green-600';
    } else if (lower.includes('nintendo') || lower.includes('switch')) {
      badgeColor = 'bg-red-600';
    } else if (lower.includes('multi')) {
      badgeColor = 'bg-purple-600';
    }
  } else if (product.condition === 'New') {
    badgeColor = 'bg-emerald-500';
  }

  const display =
    badgeText === 'PlayStation 5'
      ? 'PS5'
      : badgeText === 'PlayStation 4'
        ? 'PS4'
        : badgeText === 'Nintendo Switch'
          ? 'Switch'
          : badgeText;

  return <div className={`${className} ${badgeColor}`}>{display}</div>;
};

export interface ProductCardImageProps {
  className: string;
  imagePriority?: boolean;
  product: Product;
  sizes: string;
}

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
