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
import { startCheckoutVerificationPolling } from './start-checkout-verification-polling';
import {
  type CheckoutVerificationStatus,
  hasMatchingPendingRedvaultOrder,
  type VerifyCheckoutPaymentHandlers,
  verifyCheckoutPayment,
} from './verify-checkout-payment';

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
  /** False while hydrating a reloaded link (stashed order values unreadable). */
  isReady: boolean;
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
  isReady,
}: UseCheckoutSuccessVerificationInput) {
  const [status, setStatus] = useState<CheckoutVerificationStatus>('pending');
  const [isVerifying, setIsVerifying] = useState(false);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const statusRef = useRef<CheckoutVerificationStatus>('pending');
  const verificationIdentityRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isReady) return;
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
    const verificationIdentity = [
      merchantSlug,
      orderId,
      reference,
      trackingToken,
      paymentMethodParam,
    ].join('|');
    if (verificationIdentityRef.current !== verificationIdentity) {
      verificationIdentityRef.current = verificationIdentity;
      statusRef.current = 'pending';
      setStatus('pending');
      setOrderNumber(null);
      setPaymentMethod(null);
    }
    let disposed = false;
    const verifyHandlers: VerifyCheckoutPaymentHandlers = {
      clearCart: () => {
        if (!disposed) clearCart();
      },
      redirectToCheckout: () => {
        if (!disposed) redirectToCheckout();
      },
      scheduleFailedRedirect: () => {
        if (!disposed)
          timerHandle.current = setTimeout(redirectToCheckout, 4000);
      },
      setIsVerifying: (verifying) => {
        if (!disposed) setIsVerifying(verifying);
      },
      setOrderNumber: (number) => {
        if (!disposed) setOrderNumber(number);
      },
      setPaymentMethod: (method) => {
        if (!disposed) setPaymentMethod(method);
      },
      setStatus: (nextStatus, delayMs = 0) => {
        if (disposed) return;
        // Every verification result updates the polling guard synchronously here.
        statusRef.current = nextStatus;
        polling.delayNextPass(delayMs);
        setStatus(nextStatus);
      },
      capturePaymentCompleted: (input) => {
        if (disposed) return;
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
        if (disposed) return;
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

    const polling = startCheckoutVerificationPolling({
      isPending: () => statusRef.current === 'pending',
      verify: (signal) =>
        verifyCheckoutPayment({ ...verifyParams, signal }, verifyHandlers),
    });
    polling.start();

    return () => {
      disposed = true;
      polling.stop();
      if (timerHandle.current !== null) {
        clearTimeout(timerHandle.current);
      }
    };
  }, [
    reference,
    orderId,
    trackingToken,
    paymentMethodParam,
    merchantSlug,
    clearCart,
    router,
    basePath,
    isReady,
  ]);

  useEffect(() => {
    if (status !== 'success' || typeof window === 'undefined') {
      return;
    }

    try {
      sessionStorage.removeItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY);
    } catch {
      // Blocked storage: cleanup is best-effort and must not break success.
    }
  }, [status]);

  return { status, isVerifying, orderNumber, paymentMethod };
}
