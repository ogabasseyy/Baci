'use client';

import { formatMoneyMinor, getMoneyCurrencyExponent } from '@baci/shared/money';
import { useRef, useState } from 'react';
import { type CartItem } from '@/hooks/cart';
import { isSharedCartCheckoutDeadlineExpired } from '@/hooks/cart/shared-cart-checkout-deadline';
import {
  calculateCartItemSubtotal,
  getCartItemCheckoutUnitPrice,
} from '@/lib/checkout/cart-entitlement-sanitizer';
import {
  prepareSharedCartCheckout,
  reviewedCheckoutItems,
} from '@/hooks/cart/shared-cart-client';
import type { SharedCartCheckoutReview } from '@/hooks/cart/shared-cart-client';
import type { SharedCartSyncStatus } from '@/hooks/cart/cart-types';
import { useChatCartCheckoutReviewExpiry } from './use-chat-cart-checkout-review-expiry';

interface ChatCartCheckoutReviewProps {
  items: DisplayedCartItem[];
  merchantId: string | null | undefined;
  merchantSlug: string | null;
  currencyCode: string;
  sharedCartEnabled?: boolean;
  sharedCartRef?: { cartId: string; version: number } | null;
  syncStatus?: SharedCartSyncStatus;
  refreshSharedCart?: () => Promise<void>;
}

type DisplayedCartItem = CartItem & {
  hydrationFailed?: boolean;
  serverLineId?: string | null;
};

export function ChatCartCheckoutReview({
  items,
  merchantId,
  merchantSlug,
  currencyCode,
  sharedCartEnabled,
  sharedCartRef,
  syncStatus,
  refreshSharedCart,
}: ChatCartCheckoutReviewProps) {
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{
    review: SharedCartCheckoutReview;
    expiresAtMonotonicMs: number;
    expiresAtEpochMs: number;
    displayDetailsKey: string;
  } | null>(null);
  const operationRef = useRef<{
    scopeKey: string;
    operationId: string;
  } | null>(null);

  const sessionExpired = useChatCartCheckoutReviewExpiry(
    prepared?.expiresAtMonotonicMs ?? null,
    prepared?.expiresAtEpochMs ?? null
  );

  const displayDetailsKey = JSON.stringify(
    items.map((item) => [
      item.serverLineId ?? null,
      item.name,
      item.price,
      item.image,
      item.hydrationFailed === true,
      item.variantAttributes ?? null,
    ])
  );

  const isCurrent = Boolean(
    prepared &&
      sharedCartRef?.cartId === prepared.review.cartId &&
      sharedCartRef?.version === prepared.review.cartVersion &&
      merchantId === prepared.review.merchantId &&
      currencyCode.toUpperCase() === prepared.review.currency.toUpperCase() &&
      !isSharedCartCheckoutDeadlineExpired(
        prepared.expiresAtMonotonicMs,
        prepared.expiresAtEpochMs
      ) &&
      prepared.displayDetailsKey === displayDetailsKey &&
      !sessionExpired &&
      syncStatus === 'synced'
  );

  const handleReviewCheckout = async () => {
    if (items.length === 0 || isPreparing) return;
    setError(null);
    setPrepared(null);
    setIsPreparing(true);
    try {
      if (!sharedCartEnabled) {
        setError('In-chat checkout review is not available for this cart yet.');
        return;
      }
      if (!sharedCartRef || syncStatus !== 'synced') {
        setError(
          syncStatus === 'error'
            ? 'Your cart could not sync. Retry the sync and try again.'
            : 'Your cart is still syncing. Wait a moment and try again.'
        );
        return;
      }
      const scopeKey = `${merchantId ?? ''}:${sharedCartRef.cartId}:${sharedCartRef.version}`;
      if (operationRef.current?.scopeKey !== scopeKey) {
        operationRef.current = {
          operationId: crypto.randomUUID(),
          scopeKey,
        };
      }
      const result = await prepareSharedCartCheckout(
        {
          cartId: sharedCartRef.cartId,
          expectedVersion: sharedCartRef.version,
          operationId: operationRef.current.operationId,
        },
        merchantSlug
      );
      if (!result.ok) {
        if (!result.retryable) operationRef.current = null;
        if (result.code === 'refresh_required') {
          await refreshSharedCart?.();
          setError('Your cart changed. Review the updated items and try again.');
        } else {
          setError('We could not review your cart. Please try again.');
        }
        return;
      }
      operationRef.current = null;
      if (
        isSharedCartCheckoutDeadlineExpired(
          result.sessionExpiresAtMonotonicMs,
          result.sessionExpiresAtEpochMs
        )
      ) {
        setError('This checkout review has expired. Please review it again.');
        return;
      }
      const reviewCurrency = result.review.currency.trim().toUpperCase();
      let exponent: number;
      try {
        exponent = getMoneyCurrencyExponent(reviewCurrency);
      } catch {
        setError('In-chat checkout review is unavailable for this currency.');
        return;
      }
      if (
        reviewCurrency !== currencyCode.toUpperCase() ||
        exponent !== 2
      ) {
        setError(
          'In-chat checkout review is unavailable for this currency. Please use the store checkout.'
        );
        return;
      }
      const reviewedItems = reviewedCheckoutItems(items, result.review);
      const linePricesMatch = result.review.lines.every((line) => {
        const item = items.find((candidate) => candidate.serverLineId === line.id);
        return (
          item &&
          item.quantity === line.quantity &&
          Math.abs(getCartItemCheckoutUnitPrice(item) * 100 - line.effectiveUnitPriceMinor) < 0.5
        );
      });
      if (
        result.review.unavailableCount > 0 ||
        result.review.lines.some((line) => !line.available) ||
        Math.abs(
          result.review.subtotalMinor / 10 ** exponent -
            calculateCartItemSubtotal(items, true)
        ) > 0.005 ||
        !linePricesMatch ||
        !reviewedItems
      ) {
        await refreshSharedCart?.();
        setError(
          'Your cart or prices changed. Review the updated items and try again.'
        );
        return;
      }
      setPrepared({
        review: result.review,
        expiresAtMonotonicMs: result.sessionExpiresAtMonotonicMs,
        expiresAtEpochMs: result.sessionExpiresAtEpochMs,
        displayDetailsKey,
      });
    } catch {
      setError('We could not review your cart. Please try again.');
    } finally {
      setIsPreparing(false);
    }
  };

  return (
    <>
      {sharedCartEnabled && (
        <button
          type="button"
          onClick={handleReviewCheckout}
          disabled={isPreparing}
          className="mt-2 w-full rounded-lg bg-store-primary px-3 py-2 text-sm font-semibold text-store-primary-text hover:brightness-95 disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-store-primary"
        >
          {isPreparing ? 'Preparing checkout…' : 'Review checkout'}
        </button>
      )}
      {error && (
        <p
          className="mt-2 text-xs text-store-background-text"
          role="status"
          aria-live="polite"
        >
          {error}
        </p>
      )}
      {prepared && (
        <section
          aria-label="Authoritative checkout review"
          className="mt-3 rounded-lg border border-store-primary/30 bg-store-primary/5 p-3"
        >
          <h5 className="font-semibold">Checkout review</h5>
          {isCurrent ? (
            <>
              <ul className="mt-2 divide-y divide-store-border">
                {prepared.review.lines.map((line) => (
                  <li key={line.id} className="py-2 text-sm">
                    <div className="font-medium">
                      {line.productName?.trim() || 'Product'}
                    </div>
                    <div className="text-store-background-text/70">
                      {line.quantity} ×{' '}
                      {formatMoneyMinor(
                        line.effectiveUnitPriceMinor,
                        prepared.review.currency
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex justify-between border-t border-store-border pt-2 text-sm font-semibold">
                <span>Reviewed subtotal</span>
                <span>
                  {formatMoneyMinor(
                    prepared.review.subtotalMinor,
                    prepared.review.currency
                  )}
                </span>
              </div>
              <p className="mt-1 text-xs text-store-background-text/60">
                Shipping, tax, and the final total are determined during checkout.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm" role="status" aria-live="polite">
              {sessionExpired
                ? 'This checkout review expired. Review checkout again to refresh it.'
                : 'Your cart or currency changed after this review. Review checkout again to refresh it.'}
            </p>
          )}
        </section>
      )}
    </>
  );
}
