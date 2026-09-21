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
// still reached without a manual refresh. Fast passes cover the common
// webhook race; the slow lane keeps observing late reconciliation (e.g. a
// captured payment whose finalization lands minutes later) instead of
// stranding the mounted page on "processing" after one minute.
const VERIFY_REPOLL_INTERVAL_MS = 3000;
const VERIFY_REPOLL_FAST_MAX_ATTEMPTS = 20;
const VERIFY_REPOLL_SLOW_INTERVAL_MS = 15000;
const VERIFY_REPOLL_MAX_ATTEMPTS = 40;
// Each pass is abort-bounded so one hung connection releases the lane
// instead of stalling every later pass behind a never-settling request.
const VERIFY_REQUEST_TIMEOUT_MS = 10000;

export type { CheckoutVerificationStatus };

function hasMatchingPendingRedvaultOrder(orderId: string | null): boolean {
  if (!orderId || typeof window === 'undefined') {
    return false;
  }

  try {
    const raw = sessionStorage.getItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY);
    if (!raw) {
      return false;
    }
    const pendingOrder: unknown = JSON.parse(raw);
    if (!pendingOrder || typeof pendingOrder !== 'object') {
      return false;
    }
    const snapshot = pendingOrder as {
      orderId?: unknown;
      paymentMethod?: unknown;
    };
    return (
      snapshot.orderId === orderId && snapshot.paymentMethod === 'uba_redvault'
    );
  } catch {
    return false;
  }
}

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
      pendingRedvaultOrder: hasMatchingPendingRedvaultOrder(orderId),
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
    let passInFlight = false;
    let passController: AbortController | null = null;
    let passTimeout: ReturnType<typeof setTimeout> | null = null;
    const clearReverifyTimer = () => {
      if (reverifyTimer !== null) {
        clearTimeout(reverifyTimer);
        reverifyTimer = null;
      }
    };
    const abortPass = () => {
      if (passTimeout !== null) {
        clearTimeout(passTimeout);
        passTimeout = null;
      }
      if (passController !== null) {
        passController.abort();
        passController = null;
      }
    };
    // Serialized: the next attempt is scheduled only after the current
    // verification settles, so a slow older response can never arrive
    // after a newer success and overwrite the terminal state (or schedule
    // a redirect after payment was confirmed). Each pass is abort-bounded
    // so a hung request releases the lane for its retry instead of
    // stalling every later pass behind a never-settling connection.
    const runVerificationPass = () => {
      // Gate the pass itself on the terminal status: setStatus('success')
      // only schedules the React update, so the settling promise's
      // finally can still observe a stale 'pending' ref and arm another
      // timer. Without this check that timer performs an extra
      // verification after success, and a transient failure could flip a
      // paid order to failed (payment_failed + checkout redirect).
      if (
        disposed ||
        passInFlight ||
        statusRef.current !== 'pending' ||
        reverifyAttempts >= VERIFY_REPOLL_MAX_ATTEMPTS
      ) {
        return;
      }
      reverifyAttempts += 1;
      passInFlight = true;
      passController = new AbortController();
      passTimeout = setTimeout(() => {
        passController?.abort();
      }, VERIFY_REQUEST_TIMEOUT_MS);
      void verifyCheckoutPayment(
        { ...verifyParams, signal: passController.signal },
        verifyHandlers
      ).finally(() => {
        if (passTimeout !== null) {
          clearTimeout(passTimeout);
          passTimeout = null;
        }
        passController = null;
        passInFlight = false;
        if (
          disposed ||
          statusRef.current !== 'pending' ||
          reverifyAttempts >= VERIFY_REPOLL_MAX_ATTEMPTS
        ) {
          return;
        }
        const interval =
          reverifyAttempts < VERIFY_REPOLL_FAST_MAX_ATTEMPTS
            ? VERIFY_REPOLL_INTERVAL_MS
            : VERIFY_REPOLL_SLOW_INTERVAL_MS;
        reverifyTimer = setTimeout(() => {
          reverifyTimer = null;
          runVerificationPass();
        }, interval);
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

    // The shopper returned while a slow-lane wait was pending: revalidate
    // now instead of making them wait out the backoff.
    const revalidateOnVisible = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      if (disposed || passInFlight || reverifyTimer === null) {
        return;
      }
      if (
        statusRef.current !== 'pending' ||
        reverifyAttempts >= VERIFY_REPOLL_MAX_ATTEMPTS
      ) {
        return;
      }
      clearReverifyTimer();
      runVerificationPass();
    };
    window.addEventListener('focus', revalidateOnVisible);
    document.addEventListener('visibilitychange', revalidateOnVisible);

    runVerificationPass();

    return () => {
      disposed = true;
      clearReverifyTimer();
      abortPass();
      window.removeEventListener('focus', revalidateOnVisible);
      document.removeEventListener('visibilitychange', revalidateOnVisible);
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
