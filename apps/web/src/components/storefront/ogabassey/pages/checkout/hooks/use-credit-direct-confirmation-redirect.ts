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
 * How the idempotency cleanup may treat the shared slot, derived from
 * the pending-order handoff written at submit time:
 * - `scoped`: the handoff still names the confirming order and carries
 *   its fingerprint — clear only that checkout's key.
 * - `unscoped`: the handoff is gone, unreadable, or names this order
 *   without a fingerprint. No newer checkout could own the slot without
 *   leaving its own snapshot, so the legacy unconditional clear stands.
 * - `skip`: the handoff already names a different order — its recovery
 *   key must survive this order's cleanup.
 */
type ConfirmingCheckoutScope =
  | { kind: 'scoped'; fingerprint: string }
  | { kind: 'unscoped' }
  | { kind: 'skip' };

function readConfirmingCheckoutScope(orderId: string): ConfirmingCheckoutScope {
  try {
    const raw = window.sessionStorage.getItem(
      CHECKOUT_PENDING_ORDER_STORAGE_KEY
    );
    if (!raw) {
      return { kind: 'unscoped' };
    }
    const snapshot = JSON.parse(raw) as Partial<PendingCheckoutOrderSnapshot>;
    if (snapshot.orderId !== orderId) {
      return { kind: 'skip' };
    }
    return typeof snapshot.checkoutFingerprint === 'string' &&
      snapshot.checkoutFingerprint.trim().length > 0
      ? { kind: 'scoped', fingerprint: snapshot.checkoutFingerprint }
      : { kind: 'unscoped' };
  } catch {
    return { kind: 'unscoped' };
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
    // Read the handoff scope before it is removed below: confirmation
    // can land after a long polling interval, by which time another
    // checkout may own the shared idempotency slot.
    const confirmingCheckoutScope = readConfirmingCheckoutScope(orderId);
    try {
      window.sessionStorage.removeItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY);
      window.sessionStorage.removeItem('checkout-form');
    } catch {
      // Storage cleanup is best-effort; confirmation must still navigate.
    }
    // Scoped to the originating checkout (matching the other completion
    // paths): only a handoff naming a newer checkout skips the clear —
    // an unscoped remove there would delete the new checkout's recovery
    // key and let its retry fork a duplicate order.
    if (confirmingCheckoutScope.kind === 'scoped') {
      void clearCheckoutIdempotencyKey(confirmingCheckoutScope.fingerprint);
    } else if (confirmingCheckoutScope.kind === 'unscoped') {
      void clearCheckoutIdempotencyKey();
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
