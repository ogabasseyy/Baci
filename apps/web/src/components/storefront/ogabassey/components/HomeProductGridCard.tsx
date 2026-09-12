'use client';

import { getProductImageAlt } from '@baci/shared/lib';
import Link from 'next/link';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import { useViewportActivation } from '@/components/storefront/use-viewport-activation';
import { PLACEHOLDER_IMAGE } from '@/lib/image-utils';
import { getProductUrl } from '@/lib/seo-utils';
import { asRoute } from '@/lib/routes';
import type { Product } from '../types';
import { resolveProductImageSource } from './product-image-source';
import { ProductRatingRow } from './ProductRatingRow';

interface HomeProductGridCardProps {
  product: Product;
  basePath?: string;
  deferImageLoading?: boolean;
}

function getCriticalConditionClass(condition: Product['condition']) {
  const normalizedCondition = String(condition)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, ' ');

  if (normalizedCondition === 'new') {
    return 'ogabassey-home-product-card__condition--new';
  }

  if (normalizedCondition === 'open box') {
    return 'ogabassey-home-product-card__condition--open-box';
  }

  if (normalizedCondition === 'new & used') {
    return 'ogabassey-home-product-card__condition--new-used';
  }

  return 'ogabassey-home-product-card__condition--default';
}

export function HomeProductGridCard({
  product,
  basePath = '',
  deferImageLoading = false,
}: HomeProductGridCardProps) {
  const { ref: imageViewportRef, isActive: isImageViewportActive } =
    useViewportActivation<HTMLDivElement>({
      enabled: deferImageLoading,
      rootMargin: '150px 0px',
      timeoutMs: 6000,
    });
  const shouldRenderImage = !deferImageLoading || isImageViewportActive;
  const productHref = asRoute(
    `${basePath}${getProductUrl({ ...product, id: String(product.id) })}`
  );
  const linkTitle =
    `${product.name}${product.brand ? ` - ${product.brand}` : ''}`.trim();
  const productImage = resolveProductImageSource(
    [product.image, product.images?.[0]],
    PLACEHOLDER_IMAGE
  );
  const productImageAlt = productImage.isPlaceholder
    ? ''
    : getProductImageAlt(product, {
        renderedImageUrl: productImage.src,
      });

  // Keep geometry-affecting classes in sync with storefront-home-critical.css;
  // the homepage critical CSS provides a semantic card shell to prevent mobile CLS.
  return (
    <div className="ogabassey-home-product-card">
      <Link
        href={productHref}
        prefetch={false}
        title={linkTitle}
        className="absolute inset-0 z-0"
      >
        <span className="sr-only">
          View {product.name} for {product.price}
        </span>
      </Link>

      <div
        ref={imageViewportRef}
        className="ogabassey-home-product-card__media"
      >
        {product.condition && (
          <div
            className={`ogabassey-home-product-card__condition ${getCriticalConditionClass(product.condition)}`}
          >
            {product.condition}
          </div>
        )}

        {shouldRenderImage ? (
          <CdnFormatImage
            src={productImage.src}
            alt={productImageAlt}
            fill
            sizes="(max-width: 480px) 40vw, (max-width: 768px) 33vw, (max-width: 1200px) 25vw, 20vw"
            loading="lazy"
            fetchPriority="low"
            className="ogabassey-home-product-card__image"
          />
        ) : (
          <div className="ogabassey-home-product-card__placeholder" />
        )}
      </div>

      <div className="ogabassey-home-product-card__body">
        <h3 className="ogabassey-home-product-card__title">
          {product.name}
          {product.spec && (
            <span className="ogabassey-home-product-card__spec">
              {product.spec}
            </span>
          )}
        </h3>

        <ProductRatingRow rating={product.rating} />

        <div className="ogabassey-home-product-card__footer">
          <span className="ogabassey-home-product-card__price">
            {product.price}
          </span>
          <span className="ogabassey-home-product-card__details">
            Details
          </span>
        </div>
      </div>
    </div>
  );
}
