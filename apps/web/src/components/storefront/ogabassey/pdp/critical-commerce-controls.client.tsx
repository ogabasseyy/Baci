'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useId } from 'react';
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
    addToCartBlockedAttempt,
    addToCartBlocker,
    canAddToCart,
    handleAddToCart,
    handleDecrementCartQuantity,
    handleIncrementCartQuantity,
    isAtMaxQuantity,
    isAtMinCartQuantity,
    quantityInCart,
  } = useOgabasseyPdpCriticalCommerce();
  const blockerHintId = useId();
  // Only sold-out stock hard-disables the button. Every other blocker is
  // something the shopper can fix, so the button stays tappable and the
  // tap explains what to choose instead of doing nothing.
  const isSoldOut = addToCartBlocker?.kind === 'out-of-stock';
  const hasIncompleteSelection =
    addToCartBlocker?.kind === 'missing-selection' ||
    addToCartBlocker?.kind === 'unconfirmed-selection';
  const showInCartControls = quantityInCart > 0 && !hasIncompleteSelection;
  const removeOnDecrement = isAtMinCartQuantity;

  return (
    <div
      data-ogabassey-pdp-commerce-controls
      aria-label="Purchase controls"
      role="group"
    >
      {showInCartControls ? (
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
            aria-describedby={addToCartBlocker ? blockerHintId : undefined}
            aria-disabled={addToCartBlocker && !isSoldOut ? true : undefined}
            data-ogabassey-pdp-commerce-primary-action
            disabled={isSoldOut}
            onClick={handleAddToCart}
            type="button"
          >
            Add to cart
          </button>
          {addToCartBlocker ? (
            <p
              data-attention={addToCartBlockedAttempt > 0 ? 'true' : undefined}
              data-ogabassey-pdp-commerce-blocker
              id={blockerHintId}
              role="status"
            >
              {/* Re-inserting the text on every blocked tap makes the stable
                  status region announce it again. */}
              <span key={addToCartBlockedAttempt}>
                {addToCartBlocker.message}
              </span>
            </p>
          ) : null}
          <AssuranceDefaultNote
            canPurchase={canAddToCart}
            quantityInCart={quantityInCart}
          />
        </>
      )}
    </div>
  );
}
