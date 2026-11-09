'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { AssuranceDefaultNote } from '../pages/product-details-page/assurance-default-note';
import { useOgabasseyPdpCriticalCommerce } from './critical-commerce-state.client';

export interface OgabasseyPdpCriticalCommerceControlsProps {
  cartHref: Route;
  productName: string;
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
            role="group"
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
