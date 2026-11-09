'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useState } from 'react';
import { resolveVariantSelection } from '@baci/shared/lib';
import { getVariantConnectivityDisclosure } from '@/lib/storefront-variant-disclosure';
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
import { RouteOfferMissingNotice } from '../pages/product-details-page/route-offer-missing-notice';
import { AssuranceDefaultNote } from '../pages/product-details-page/assurance-default-note';
import {
  OgabasseyPdpCriticalCommerceProvider,
  useOgabasseyPdpCriticalCommerce,
  useOptionalOgabasseyPdpCriticalCommerce,
} from './critical-commerce-state.client';
import { OgabasseyPdpCriticalVariantSelectors } from './critical-variant-selectors.client';

export {
  OgabasseyPdpCriticalCommerceConditionFact,
  OgabasseyPdpCriticalConditionBadge,
} from './critical-commerce-condition.client';
export { OgabasseyPdpCriticalCommerceProvider } from './critical-commerce-state.client';

interface OgabasseyPdpCriticalCommerceClientProps {
  cartHref: Route;
  cartProduct: CartProduct;
  initialVariantSelection?: InitialCriticalVariantSelection;
  initialOfferId?: string | null;
  routeOfferMissing?: boolean;
  productName: string;
  variantAxes?: string[];
  variantAxisOptions?: Record<string, string[]>;
  variantCount: number;
}

interface OgabasseyPdpCriticalCommerceControlsProps {
  cartHref: Route;
  productName: string;
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
    routeOfferMissingActive,
    selectedAttributes,
    variantAxisOptions,
    variants,
  } = useOgabasseyPdpCriticalCommerce();
  const selectedVariant =
    (variants && variants.length > 0
      ? resolveVariantSelection(
          { ...productForCart, variants },
          { attributes: selectedAttributes }
        )?.variant ??
        variants.find((variant) =>
          Object.entries(selectedAttributes).every(
            ([key, value]) => !value || variant.attributes?.[key] === value
          )
        )
      : null);
  const connectivityDisclosure = getVariantConnectivityDisclosure(
    selectedVariant ?? {
      id: '',
      attributes: selectedAttributes,
    }
  );

  return (
    <>
      {routeOfferMissingActive ? <RouteOfferMissingNotice /> : null}
      {connectivityDisclosure ? (
        <p role="note">{connectivityDisclosure}</p>
      ) : null}
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
    handleDecrementCartQuantity,
    handleIncrementCartQuantity,
    isAtMaxQuantity,
    isAtMinCartQuantity,
    productForCart,
    quantityInCart,
  } = useOgabasseyPdpCriticalCommerce();
  const removeOnDecrement =
    isAtMinCartQuantity ??
    quantityInCart <= Math.max(1, productForCart?.minimum_order_quantity ?? 1);

  return (
    <div
      data-ogabassey-pdp-commerce-controls
      aria-label="Purchase controls"
      role="group"
    >
      {quantityInCart > 0 ? (
        <div data-ogabassey-pdp-commerce-in-cart-actions>
          <div
            data-ogabassey-pdp-commerce-quantity
            aria-label="Quantity"
          >
            <button
              aria-label={
                removeOnDecrement
                  ? `Remove ${productName} from cart`
                  : `Decrease quantity for ${productName}`
              }
              onClick={handleDecrementCartQuantity}
              type="button"
            >
              {removeOnDecrement ? (
                <svg
                  aria-hidden="true"
                  fill="none"
                  height="18"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="18"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  <line x1="10" x2="10" y1="11" y2="17" />
                  <line x1="14" x2="14" y1="11" y2="17" />
                </svg>
              ) : (
                '-'
              )}
            </button>
            <output aria-live="polite">
              <span data-ogabassey-pdp-commerce-in-cart-label>In Cart</span>
              <span data-ogabassey-pdp-commerce-in-cart-value>
                {quantityInCart}
              </span>
            </output>
            <button
              aria-label={`Increase quantity for ${productName}`}
              disabled={!canAddToCart || isAtMaxQuantity}
              onClick={handleIncrementCartQuantity}
              type="button"
            >
              +
            </button>
          </div>
          <Link
            data-ogabassey-pdp-commerce-secondary-action
            href={cartHref}
            prefetch={false}
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="18"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="18"
            >
              <circle cx="8" cy="21" r="1" />
              <circle cx="19" cy="21" r="1" />
              <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
            </svg>
            View cart
          </Link>
        </div>
      ) : (
        <>
          <button
            data-ogabassey-pdp-commerce-primary-action
            disabled={!canAddToCart}
            onClick={handleAddToCart}
            type="button"
          >
            Add to cart
          </button>
          <AssuranceDefaultNote
            canPurchase={canAddToCart}
            quantityInCart={quantityInCart}
          />
        </>
      )}
    </div>
  );
}

export function OgabasseyPdpCriticalCommerceClient({
  cartHref,
  cartProduct,
  initialVariantSelection,
  initialOfferId,
  routeOfferMissing,
  productName,
  variantAxes = [],
  variantAxisOptions = {},
  variantCount,
}: OgabasseyPdpCriticalCommerceClientProps) {
  return (
    <OgabasseyPdpCriticalCommerceProvider
      cartProduct={cartProduct}
      initialVariantSelection={initialVariantSelection}
      initialOfferId={initialOfferId}
      routeOfferMissing={routeOfferMissing}
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
