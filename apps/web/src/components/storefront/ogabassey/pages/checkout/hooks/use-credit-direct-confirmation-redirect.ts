import type { Route } from 'next';
import type { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { captureBnplPaymentCompleted } from '../capture-bnpl-payment-completed';
import { clearCheckoutIdempotencyKey } from '../checkout-idempotency';
import {
  clearCreditDirectPopupMarker,
  type CreditDirectPopupMarker,
} from '../credit-direct-popup-return';
import {
  CHECKOUT_PENDING_ORDER_STORAGE_KEY,
  type PendingCheckoutOrderSnapshot,
} from '../pending-checkout-order';
import type { CreditDirectVerificationPhase } from './use-credit-direct-verification';

/**
 * Originating-checkout fingerprint from the pending-order handoff: the
 * snapshot is written at submit time, so when it still names the
 * confirming order its fingerprint identifies the stored idempotency
 * key as ours. Returns undefined when the handoff is gone or already
 * names another checkout — the caller must then skip the clear rather
 * than drop a newer checkout's recovery key.
 */
function readConfirmingCheckoutFingerprint(
  orderId: string
): string | undefined {
  try {
    const raw = window.sessionStorage.getItem(
      CHECKOUT_PENDING_ORDER_STORAGE_KEY
    );
    if (!raw) {
      return undefined;
    }
    const snapshot = JSON.parse(raw) as Partial<PendingCheckoutOrderSnapshot>;
    if (snapshot.orderId !== orderId) {
      return undefined;
    }
    return typeof snapshot.checkoutFingerprint === 'string' &&
      snapshot.checkoutFingerprint.trim().length > 0
      ? snapshot.checkoutFingerprint
      : undefined;
  } catch {
    return undefined;
  }
}

interface UseCreditDirectConfirmationRedirectOptions {
  phase: CreditDirectVerificationPhase;
  marker: CreditDirectPopupMarker | null;
  orderId: string | null;
  trackingToken: string | null;
  lookupEmail: string | null;
  confirmedTotal?: number;
  confirmedCurrency?: string;
  orderSuccessBasePath: string;
  clearCart?: () => void;
  router: ReturnType<typeof useRouter>;
}

/**
 * Owns the Credit Direct confirmed-cleanup lifecycle: first conversion
 * capture, checkout-state cleanup, and navigation to order-success.
 * Extracted from bnpl-launcher.tsx (300-line file limit).
 */
export function useCreditDirectConfirmationRedirect({
  phase,
  marker,
  orderId,
  trackingToken,
  lookupEmail,
  confirmedTotal,
  confirmedCurrency,
  orderSuccessBasePath,
  clearCart,
  router,
}: UseCreditDirectConfirmationRedirectOptions): void {
  const confirmedCleanupKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (phase !== 'confirmed' || !orderId || !marker) {
      return;
    }

    const cleanupKey = `${orderId}:${marker.transactionId}`;
    if (confirmedCleanupKeyRef.current === cleanupKey) {
      return;
    }
    confirmedCleanupKeyRef.current = cleanupKey;

    const successQuery = new URLSearchParams({
      orderId,
      reference: marker.transactionId,
      type: 'credit_direct',
    });
    // Pass the verified row into the first capture: the once-guard
    // would otherwise suppress the richer order-success lookup,
    // leaving the conversion valueless.
    captureBnplPaymentCompleted({
      orderId,
      paymentMethod: 'credit_direct',
      reference: marker.transactionId,
      ...(confirmedTotal !== undefined ? { value: confirmedTotal } : {}),
      ...(confirmedCurrency ? { currency: confirmedCurrency } : {}),
    });
    if (trackingToken) {
      successQuery.set('trackingToken', trackingToken);
    } else if (lookupEmail) {
      // Email-only guest lookups have no tracking token; order-success
      // needs the email to fetch the order it is celebrating.
      successQuery.set('email', lookupEmail);
    }
    clearCart?.();
    // Read the originating fingerprint before the handoff below is
    // removed: confirmation can land after a long polling interval, by
    // which time another checkout may own the shared idempotency slot.
    const confirmingCheckoutFingerprint =
      readConfirmingCheckoutFingerprint(orderId);
    try {
      window.sessionStorage.removeItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY);
      window.sessionStorage.removeItem('checkout-form');
    } catch {
      // Storage cleanup is best-effort; confirmation must still navigate.
    }
    // Scoped to the originating checkout (matching the other completion
    // paths): when the handoff is gone or already names a newer
    // checkout, skip the clear — an unscoped remove would delete the new
    // checkout's recovery key and let its retry fork a duplicate order.
    if (confirmingCheckoutFingerprint) {
      void clearCheckoutIdempotencyKey(confirmingCheckoutFingerprint);
    }
    clearCreditDirectPopupMarker(orderId);
    router.push(
      `${orderSuccessBasePath}?${successQuery.toString()}` as Route
    );
  }, [
    phase,
    confirmedTotal,
    confirmedCurrency,
    marker,
    orderId,
    trackingToken,
    lookupEmail,
    orderSuccessBasePath,
    clearCart,
    router,
  ]);
}
