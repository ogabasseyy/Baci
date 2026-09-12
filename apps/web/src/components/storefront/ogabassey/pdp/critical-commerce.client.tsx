'use client';

import {
  formatCanonicalProductConditionLabel,
  sortCanonicalProductConditionsByPreference,
} from '@baci/shared/lib';
import Link from 'next/link';
import type { Route } from 'next';
import { useState } from 'react';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import type { Product as CartProduct } from '@/lib/products';
import {
  OGABASSEY_PDP_PRIMARY_IMAGE_QUALITY,
  OGABASSEY_PDP_PRIMARY_IMAGE_SIZES,
} from '@/components/storefront/ogabassey/config/product-media';
import {
  formatCriticalPrice,
  type InitialCriticalVariantSelection,
} from './critical-commerce-selection';
import {
  OgabasseyPdpCriticalCommerceProvider,
  useOptionalOgabasseyPdpCriticalCommerce,
  useOgabasseyPdpCriticalCommerce,
} from './critical-commerce-state.client';
import { getVariantAxisOptions } from './critical-variant-selector-options';
import { OgabasseyPdpCriticalVariantSelectors } from './critical-variant-selectors.client';

export { OgabasseyPdpCriticalCommerceProvider } from './critical-commerce-state.client';

interface OgabasseyPdpCriticalCommerceClientProps {
  cartHref: Route;
  cartProduct: CartProduct;
  initialVariantSelection?: InitialCriticalVariantSelection;
  productName: string;
  variantAxes?: string[];
  variantAxisOptions?: Record<string, string[]>;
  variantCount: number;
}

interface OgabasseyPdpCriticalCommerceControlsProps {
  cartHref: Route;
  productName: string;
}

function formatCriticalCondition(condition: string | null | undefined) {
  return formatCanonicalProductConditionLabel(condition) || null;
}

function getCriticalMixedConditionLabel(conditions: string[]) {
  const sortedConditions =
    sortCanonicalProductConditionsByPreference(conditions);

  if (sortedConditions.length <= 1) {
    return null;
  }

  return sortedConditions.length === 2 &&
    sortedConditions.includes('new') &&
    sortedConditions.includes('used')
    ? 'New & Used'
    : 'Multiple Conditions';
}

export function OgabasseyPdpCriticalConditionBadge({
  fallbackCondition,
}: {
  fallbackCondition?: string | null;
}) {
  const commerceState = useOptionalOgabasseyPdpCriticalCommerce();
  const conditionOptions = commerceState
    ? getVariantAxisOptions(
        commerceState.variants,
        'condition',
        commerceState.variantAxisOptions
      )
    : [];
  const condition =
    getCriticalMixedConditionLabel(conditionOptions) ||
    formatCriticalCondition(
      commerceState?.productForCart.condition ?? fallbackCondition
    );

  if (!condition) {
    return null;
  }

  return <span data-ogabassey-pdp-condition>{condition}</span>;
}

export function OgabasseyPdpCriticalCommerceConditionFact({
  fallbackCondition,
}: {
  fallbackCondition?: string | null;
}) {
  const commerceState = useOptionalOgabasseyPdpCriticalCommerce();
  const condition = formatCriticalCondition(
    commerceState?.productForCart.condition ?? fallbackCondition
  );

  if (!condition) {
    return null;
  }

  return (
    <p data-ogabassey-pdp-commerce-fact>
      <span>Condition</span>
      <strong>{condition}</strong>
    </p>
  );
}

export function OgabasseyPdpCriticalProductImage({
  alt,
  fallbackImage,
}: {
  alt: string;
  fallbackImage: string;
}) {
  const commerceState = useOptionalOgabasseyPdpCriticalCommerce();
  // Track images that fail to load (e.g. a variant photo that 404s on the CDN)
  // so the above-the-fold LCP image never stays broken — it falls back to the
  // product's base image, matching the gallery's fallback behavior.
  const [brokenImages, setBrokenImages] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const preferredImage = commerceState?.productForCart.image || fallbackImage;
  const image =
    preferredImage && !brokenImages.has(preferredImage)
      ? preferredImage
      : fallbackImage && !brokenImages.has(fallbackImage)
        ? fallbackImage
        : null;

  if (!image) {
    return null;
  }

  return (
    // Explicit per-format `<picture>` (AVIF `<source>` + jpeg/png `<img>`
    // fallback) so the LCP hero paints the same AVIF bytes the PDP resource
    // hint preloads — Cloudflare Free ignores `Vary: Accept`, so a single
    // `format=auto` URL could serve non-AVIF browsers undecodable bytes.
    <CdnFormatImage
      alt={alt}
      data-ogabassey-pdp-image="true"
      fetchPriority="high"
      fill
      key={image}
      loading="eager"
      onError={() =>
        setBrokenImages((previous) =>
          !image || previous.has(image)
            ? previous
            : new Set(previous).add(image)
        )
      }
      quality={OGABASSEY_PDP_PRIMARY_IMAGE_QUALITY}
      sizes={OGABASSEY_PDP_PRIMARY_IMAGE_SIZES}
      src={image}
    />
  );
}

export function OgabasseyPdpCriticalCommerceSummary() {
  const {
    currency,
    handleAttributeSelection,
    productForCart,
    renderableVariantAxes,
    selectedAttributes,
    variantAxisOptions,
    variantCount,
    variants,
  } = useOgabasseyPdpCriticalCommerce();

  return (
    <>
      <div data-ogabassey-pdp-price>
        <span data-ogabassey-pdp-price-live>
          {formatCriticalPrice(productForCart.price, currency)}
        </span>
      </div>
      <div data-ogabassey-pdp-summary-variant-slot>
        <OgabasseyPdpCriticalVariantSelectors
          onAttributeSelection={handleAttributeSelection}
          renderableVariantAxes={renderableVariantAxes}
          selectedAttributes={selectedAttributes}
          variantAxisOptions={variantAxisOptions}
          variantCount={variantCount}
          variants={variants}
        />
      </div>
    </>
  );
}

export function OgabasseyPdpCriticalCommerceControls({
  cartHref,
  productName,
}: OgabasseyPdpCriticalCommerceControlsProps) {
  const {
    canAddToCart,
    handleAddToCart,
    isAtMaxQuantity,
    maxQuantity,
    quantity,
    setQuantity,
  } = useOgabasseyPdpCriticalCommerce();

  return (
    <div
      data-ogabassey-pdp-commerce-controls
      aria-label="Purchase controls"
      role="group"
    >
      <div
        data-ogabassey-pdp-commerce-quantity
        aria-label="Quantity"
      >
        <button
          aria-label={`Decrease quantity for ${productName}`}
          disabled={quantity <= 1}
          onClick={() => setQuantity((current) => Math.max(1, current - 1))}
          type="button"
        >
          -
        </button>
        <output aria-live="polite">{quantity}</output>
        <button
          aria-label={`Increase quantity for ${productName}`}
          disabled={isAtMaxQuantity}
          onClick={() =>
            setQuantity((current) =>
              maxQuantity === null
                ? current + 1
                : Math.min(maxQuantity, current + 1)
            )
          }
          type="button"
        >
          +
        </button>
      </div>
      <button
        data-ogabassey-pdp-commerce-primary-action
        disabled={!canAddToCart}
        onClick={handleAddToCart}
        type="button"
      >
        Add to cart
      </button>
      <Link
        data-ogabassey-pdp-commerce-secondary-action
        href={cartHref}
      >
        View cart
      </Link>
    </div>
  );
}

export function OgabasseyPdpCriticalCommerceClient({
  cartHref,
  cartProduct,
  initialVariantSelection,
  productName,
  variantAxes = [],
  variantAxisOptions = {},
  variantCount,
}: OgabasseyPdpCriticalCommerceClientProps) {
  return (
    <OgabasseyPdpCriticalCommerceProvider
      cartProduct={cartProduct}
      initialVariantSelection={initialVariantSelection}
      variantAxes={variantAxes}
      variantAxisOptions={variantAxisOptions}
      variantCount={variantCount}
    >
      <OgabasseyPdpCriticalCommerceSummary />
      <OgabasseyPdpCriticalCommerceControls
        cartHref={cartHref}
        productName={productName}
      />
    </OgabasseyPdpCriticalCommerceProvider>
  );
}
