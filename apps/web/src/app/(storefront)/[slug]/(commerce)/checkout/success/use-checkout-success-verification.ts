'use client';

import {
  buildCheckoutFunnelProperties,
  CHECKOUT_FUNNEL_EVENTS,
  getCheckoutPaymentIntent,
} from '@baci/shared/contracts';
import type { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CHECKOUT_PENDING_ORDER_STORAGE_KEY } from '@/components/storefront/ogabassey/pages/checkout/pending-checkout-order';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import { asRoute } from '@/lib/routes';
import {
  type CheckoutVerificationStatus,
  type VerifyCheckoutPaymentHandlers,
  verifyCheckoutPayment,
} from './verify-checkout-payment';

// A pending gateway response can settle shortly after the first verify
// call: re-run verification on a bounded poll so the completed branch is
// still reached without a manual refresh.
const VERIFY_REPOLL_INTERVAL_MS = 3000;
const VERIFY_REPOLL_MAX_ATTEMPTS = 20;

export type { CheckoutVerificationStatus };

interface UseCheckoutSuccessVerificationInput {
  merchantSlug: string | undefined;
  orderId: string | null;
  paymentMethodParam: string | null;
  reference: string | null;
  trackingToken: string | null;
  clearCart: () => void;
  router: ReturnType<typeof useRouter>;
  basePath: string;
}

/**
 * Owns the checkout-success verification lifecycle: terminal-state
 * coordination, bounded re-verification polling, the failed-redirect
 * timer, funnel attribution, and pending-order cleanup.
 */
export function useCheckoutSuccessVerification({
  merchantSlug,
  orderId,
  paymentMethodParam,
  reference,
  trackingToken,
  clearCart,
  router,
  basePath,
}: UseCheckoutSuccessVerificationInput) {
  const [status, setStatus] = useState<CheckoutVerificationStatus>('pending');
  const [isVerifying, setIsVerifying] = useState(false);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const statusRef = useRef<CheckoutVerificationStatus>('pending');
  const verificationIdentityRef = useRef<string | null>(null);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler handles memoization
  useEffect(() => {
    // Track the failed-redirect timer so navigating away from this page
    // cancels it — without the cleanup, a user who leaves within the 4s
    // window gets yanked back to /checkout.
    const timerHandle: { current: ReturnType<typeof setTimeout> | null } = {
      current: null,
    };
    const getHref = (path: string) =>
      path.startsWith('http') ? path : `${basePath}${path}`;
    const redirectToCheckout = () => {
      router.push(asRoute(getHref('/checkout')));
    };

    const verifyParams = {
      merchantSlug,
      orderId,
      paymentMethod: paymentMethodParam,
      reference,
      trackingToken,
    };
    // App Router reuses this component when client-side navigation only
    // changes the query: without a reset, the previous checkout's
    // terminal status/order details linger and the guard below refuses
    // to verify the new identity at all.
    const verificationIdentity = [orderId, reference, trackingToken].join('|');
    if (verificationIdentityRef.current !== verificationIdentity) {
      verificationIdentityRef.current = verificationIdentity;
      statusRef.current = 'pending';
      setStatus('pending');
      setOrderNumber(null);
      setPaymentMethod(null);
    }
    let disposed = false;
    let reverifyTimer: ReturnType<typeof setTimeout> | null = null;
    let reverifyAttempts = 0;
    const clearReverifyTimer = () => {
      if (reverifyTimer !== null) {
        clearTimeout(reverifyTimer);
        reverifyTimer = null;
      }
    };
    // Serialized: the next attempt is scheduled only after the current
    // verification settles, so a slow older response can never arrive
    // after a newer success and overwrite the terminal state (or schedule
    // a redirect after payment was confirmed).
    const runVerificationPass = () => {
      // Gate the pass itself on the terminal status: setStatus('success')
      // only schedules the React update, so the settling promise's
      // finally can still observe a stale 'pending' ref and arm another
      // timer. Without this check that timer performs an extra
      // verification after success, and a transient failure could flip a
      // paid order to failed (payment_failed + checkout redirect).
      if (
        disposed ||
        statusRef.current !== 'pending' ||
        reverifyAttempts >= VERIFY_REPOLL_MAX_ATTEMPTS
      ) {
        return;
      }
      reverifyAttempts += 1;
      void verifyCheckoutPayment(verifyParams, verifyHandlers).finally(() => {
        if (
          disposed ||
          statusRef.current !== 'pending' ||
          reverifyAttempts >= VERIFY_REPOLL_MAX_ATTEMPTS
        ) {
          return;
        }
        reverifyTimer = setTimeout(() => {
          reverifyTimer = null;
          runVerificationPass();
        }, VERIFY_REPOLL_INTERVAL_MS);
      });
    };
    const verifyHandlers: VerifyCheckoutPaymentHandlers = {
      clearCart,
      redirectToCheckout,
      scheduleFailedRedirect: () => {
        timerHandle.current = setTimeout(redirectToCheckout, 4000);
      },
      setIsVerifying,
      setOrderNumber,
      setPaymentMethod,
      setStatus,
      capturePaymentCompleted: (input) => {
        captureCheckoutFunnelEventOnce(
          CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
          input.orderId,
          buildCheckoutFunnelProperties({
            channel: 'web',
            currency: input.currency,
            orderId: input.orderId,
            orderNumber: input.orderNumber,
            paymentIntent: getCheckoutPaymentIntent(input.paymentMethod),
            paymentMethod: input.paymentMethod,
            paymentStatus: 'paid',
            reference: input.reference,
            source: 'web_checkout',
            total: input.total,
          })
        );
      },
      capturePaymentFailed: (input) => {
        // A retry reuses the order with a new gateway reference: claim the
        // failure per attempt so a later failed attempt is not suppressed
        // by the first one (same reference still dedupes on re-verify).
        const failureKey =
          input.orderId && input.reference
            ? `${input.orderId}:${input.reference}`
            : input.orderId || input.reference || 'unknown-order';
        captureCheckoutFunnelEventOnce(
          CHECKOUT_FUNNEL_EVENTS.paymentFailed,
          failureKey,
          buildCheckoutFunnelProperties({
            channel: 'web',
            orderId: input.orderId ?? undefined,
            orderNumber: input.orderNumber,
            paymentIntent: input.paymentMethod
              ? getCheckoutPaymentIntent(input.paymentMethod)
              : undefined,
            paymentMethod: input.paymentMethod ?? undefined,
            reason: input.reason,
            reference: input.reference ?? undefined,
            source: 'web_checkout',
          })
        );
      },
    };

    runVerificationPass();

    return () => {
      disposed = true;
      clearReverifyTimer();
      if (timerHandle.current !== null) {
        clearTimeout(timerHandle.current);
      }
    };
  }, [
    reference,
    orderId,
    trackingToken,
    merchantSlug,
    clearCart,
    router,
    basePath,
  ]);

  useEffect(() => {
    if (status !== 'success' || typeof window === 'undefined') {
      return;
    }

    sessionStorage.removeItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY);
  }, [status]);

  return { status, isVerifying, orderNumber, paymentMethod };
}
