'use client';

import { useState } from 'react';
import {
  buildCheckoutFunnelProperties,
  CHECKOUT_FUNNEL_EVENTS,
  getCheckoutPaymentIntent,
} from '@baci/shared/contracts';
import { toast } from '@/hooks/use-toast';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import { useCryptoPaymentInitializer } from '../use-crypto-payment-initializer';
import type {
  CryptoChain,
  CryptoCurrency,
  CryptoPaymentData,
  CryptoVerificationStatus,
  PendingCryptoOrder,
} from '../types';
import { useJuicywayVerification } from './use-juicyway-verification';

export type { CryptoVerificationStatus };

export interface JuicywayPendingOrder extends PendingCryptoOrder {
  /** Full order total: `amount` is only the residual due at the gateway
   * after wallet/savings credits, but purchase revenue is the whole order.
   */
  total: number;
  /** Stamped order currency (authoritative for payment initialization). */
  orderCurrency: string;
}

export interface UseJuicywayPaymentOptions {
  merchantId?: string | null;
  pendingCryptoOrder: JuicywayPendingOrder | null;
  selectedCryptoChain: CryptoChain;
  selectedCryptoCurrency: CryptoCurrency;
  setShowCryptoSelector: (visible: boolean) => void;
  clearCheckoutSession: () => void;
  clearPendingCheckoutOrder: () => void;
  clearCart: () => void;
  routerPush: (url: string) => void;
  getHref: (path: string) => string;
}

// Lifecycle claims pair a start with its failure per attempt: a retry
// initializes a new reference/payment ID, so keying by order alone would
// let the first attempt suppress the retry's events. Completions stay
// order-keyed (one conversion per order).
export function juicywayAttemptKey(
  orderId: string,
  reference: string,
  paymentId: string
): string {
  return `${orderId}:${reference || paymentId}`;
}

/**
 * Owns the Juicyway deposit lifecycle: address initialization, deposit
 * modal state, completion/failure analytics, cleanup, and success
 * navigation. Verification polling lives in use-juicyway-verification.
 * Extracted from the checkout page (Boy Scout Rule).
 */
export function useJuicywayPayment({
  merchantId,
  pendingCryptoOrder,
  selectedCryptoChain,
  selectedCryptoCurrency,
  setShowCryptoSelector,
  clearCheckoutSession,
  clearPendingCheckoutOrder,
  clearCart,
  routerPush,
  getHref,
}: UseJuicywayPaymentOptions) {
  const [cryptoPaymentData, setCryptoPaymentData] =
    useState<CryptoPaymentData | null>(null);

  const cryptoInitializer = useCryptoPaymentInitializer({
    onReady: (payment) => {
      setShowCryptoSelector(false);
      setCryptoPaymentData(payment);
      // The normal Juicyway flow returns after opening the selector, so the
      // generic initialization branch below is unreachable for it: the start
      // fires here once address initialization succeeds.
      captureCheckoutFunnelEventOnce(
        CHECKOUT_FUNNEL_EVENTS.paymentStarted,
        juicywayAttemptKey(
          payment.orderId,
          payment.reference,
          payment.paymentId
        ),
        buildCheckoutFunnelProperties({
          channel: 'web',
          currency: pendingCryptoOrder?.orderCurrency ?? 'NGN',
          orderId: payment.orderId,
          paymentIntent: getCheckoutPaymentIntent('juicyway'),
          paymentMethod: 'juicyway',
          // Attempt-level reconciliation: a retry mints a new provider
          // reference, and the failure/completion events are
          // reference-stamped — the start must carry it too (with the
          // payment ID fallback the attempt key uses).
          reference: payment.reference || payment.paymentId,
          source: 'web_checkout',
          total: pendingCryptoOrder?.amount,
        })
      );
    },
    onError: (error) =>
      toast({
        title: 'Crypto Payment Failed',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to initialize crypto payment',
        variant: 'destructive',
      }),
  });

  const initializeCryptoPayment = async () => {
    if (!pendingCryptoOrder || !merchantId) return;
    await cryptoInitializer
      .initialize({
        merchantId,
        pendingOrder: pendingCryptoOrder,
        chain: selectedCryptoChain,
        currency: selectedCryptoCurrency,
        orderCurrency: pendingCryptoOrder.orderCurrency,
      })
      .catch(() => undefined);
  };

  // Records the paid conversion for a server-confirmed Juicyway payment,
  // then runs the shared success cleanup and redirect. (The verification
  // hook settles its checking state before invoking this.)
  const completeCryptoPayment = () => {
    if (!cryptoPaymentData) {
      return;
    }
    captureCheckoutFunnelEventOnce(
      CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
      cryptoPaymentData.orderId,
      buildCheckoutFunnelProperties({
        channel: 'web',
        currency: pendingCryptoOrder?.orderCurrency ?? 'NGN',
        orderId: cryptoPaymentData.orderId,
        paymentIntent: getCheckoutPaymentIntent('juicyway'),
        paymentMethod: 'juicyway',
        paymentStatus: 'paid',
        reference: cryptoPaymentData.reference,
        source: 'web_checkout',
        total: pendingCryptoOrder?.total ?? pendingCryptoOrder?.amount,
      })
    );
    clearPendingCheckoutOrder();
    clearCheckoutSession();
    clearCart();
    const successQuery = new URLSearchParams({
      type: 'crypto',
      orderId: cryptoPaymentData.orderId,
      reference: cryptoPaymentData.reference,
    });
    if (cryptoPaymentData.trackingToken) {
      successQuery.set('trackingToken', cryptoPaymentData.trackingToken);
    }
    routerPush(getHref(`/order-success?${successQuery.toString()}`));
  };

  // Records an attempt-scoped failure for a terminally failed Juicyway
  // verification, closing the payment_started recorded when the deposit
  // address initialized. The attempt key pairs it with its own start.
  // (The verification hook settles its checking state before invoking
  // this.)
  const failCryptoPayment = (reason: string) => {
    if (!cryptoPaymentData) {
      return;
    }
    // The session's payment id is dead: evict it so a same-network retry
    // initializes a replacement instead of reusing the failed session.
    if (pendingCryptoOrder && merchantId) {
      cryptoInitializer.evictSession({
        merchantId,
        pendingOrder: pendingCryptoOrder,
        chain: selectedCryptoChain,
        currency: selectedCryptoCurrency,
      });
    }
    captureCheckoutFunnelEventOnce(
      CHECKOUT_FUNNEL_EVENTS.paymentFailed,
      juicywayAttemptKey(
        cryptoPaymentData.orderId,
        cryptoPaymentData.reference,
        cryptoPaymentData.paymentId
      ),
      buildCheckoutFunnelProperties({
        channel: 'web',
        currency: pendingCryptoOrder?.orderCurrency ?? 'NGN',
        orderId: cryptoPaymentData.orderId,
        paymentIntent: getCheckoutPaymentIntent('juicyway'),
        paymentMethod: 'juicyway',
        reason,
        reference: cryptoPaymentData.reference,
        source: 'web_checkout',
        total: pendingCryptoOrder?.total ?? pendingCryptoOrder?.amount,
      })
    );
  };

  const verification = useJuicywayVerification({
    target: cryptoPaymentData,
    onConfirmed: completeCryptoPayment,
    onTerminalFailure: failCryptoPayment,
  });

  const dismissCryptoModal = () => {
    setCryptoPaymentData(null);
    verification.reset();
  };

  return {
    cryptoPaymentData,
    setCryptoPaymentData,
    isVerifyingCrypto: verification.isVerifying,
    cryptoVerificationStatus: verification.status,
    isInitializingCrypto: cryptoInitializer.isInitializing,
    initializeCryptoPayment,
    verifyCryptoPayment: verification.verify,
    dismissCryptoModal,
    cancelCryptoInitialization: cryptoInitializer.cancel,
  };
}
