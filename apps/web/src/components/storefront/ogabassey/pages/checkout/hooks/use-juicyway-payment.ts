'use client';

import { useEffect, useRef, useState } from 'react';
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
  PendingCryptoOrder,
} from '../types';

export interface JuicywayPendingOrder extends PendingCryptoOrder {
  /** Full order total: `amount` is only the residual due at the gateway
   * after wallet/savings credits, but purchase revenue is the whole order.
   */
  total: number;
  /** Stamped order currency (authoritative for payment initialization). */
  orderCurrency: string;
}

export type CryptoVerificationStatus =
  | 'idle'
  | 'checking'
  | 'confirmed'
  | 'pending'
  | 'failed';

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
 * modal state, verification polling, completion/failure analytics,
 * cleanup, and success navigation. Extracted from the checkout page
 * (Boy Scout Rule).
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
  const [isVerifyingCrypto, setIsVerifyingCrypto] = useState(false);
  const [cryptoVerificationStatus, setCryptoVerificationStatus] =
    useState<CryptoVerificationStatus>('idle');

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

  // Verify crypto payment status by polling the API
  // Uses a ref to track polling state to avoid stale closure issues
  const pollingRef = useRef<{
    intervalId: NodeJS.Timeout | null;
    attempts: number;
  }>({
    intervalId: null,
    attempts: 0,
  });

  // Records the paid conversion for a server-confirmed Juicyway payment,
  // then runs the shared success cleanup and redirect.
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
    setIsVerifyingCrypto(false);
    setCryptoVerificationStatus('confirmed');
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
  const failCryptoPayment = (reason: string) => {
    if (!cryptoPaymentData) {
      return;
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
    setIsVerifyingCrypto(false);
    setCryptoVerificationStatus('failed');
  };

  const verifyCryptoPayment = async () => {
    // Use paymentId for verification (from the capture response)
    // Fall back to sessionId if paymentId is not available
    const verificationId =
      cryptoPaymentData?.paymentId || cryptoPaymentData?.sessionId;

    if (!verificationId) {
      console.error('No payment ID or session ID available for verification');
      failCryptoPayment('juicyway_error');
      return;
    }

    setIsVerifyingCrypto(true);
    setCryptoVerificationStatus('checking');
    pollingRef.current.attempts = 0;

    const checkPaymentStatus = async (): Promise<
      'confirmed' | 'failed' | 'pending'
    > => {
      try {
        // Use payment_id parameter for GET /payments/{id} endpoint
        const response = await fetch(
          `/api/payments/status?gateway=juicyway&payment_id=${verificationId}`
        );

        if (!response.ok) {
          // Try to parse error, but handle JSON parse failures gracefully
          let errorData = {};
          try {
            errorData = await response.json();
          } catch {
            errorData = { message: `HTTP ${response.status}: ${response.statusText}` };
          }
          console.error('Payment status check failed:', {
            status: response.status,
            statusText: response.statusText,
            paymentId: verificationId,
            error: errorData,
          });
          return 'pending'; // Treat API errors as pending, not failed
        }

        const result = await response.json();

        if (result.is_confirmed) {
          return 'confirmed';
        }

        if (result.is_failed) {
          return 'failed';
        }

        return 'pending';
      } catch (error) {
        console.error('Payment verification error:', error);
        return 'pending';
      }
    };

    // Initial check
    const initialStatus = await checkPaymentStatus();

    if (initialStatus === 'confirmed') {
      completeCryptoPayment();
      return;
    }

    if (initialStatus === 'failed') {
      failCryptoPayment('juicyway_error');
      return;
    }

    // Start polling
    setCryptoVerificationStatus('pending');

    pollingRef.current.intervalId = setInterval(async () => {
      pollingRef.current.attempts++;
      const maxAttempts = 30; // 5 minutes (30 * 10 seconds)

      if (pollingRef.current.attempts >= maxAttempts) {
        if (pollingRef.current.intervalId) {
          clearInterval(pollingRef.current.intervalId);
          pollingRef.current.intervalId = null;
        }
        setIsVerifyingCrypto(false);
        setCryptoVerificationStatus('pending');
        return;
      }

      const status = await checkPaymentStatus();

      if (status === 'confirmed') {
        if (pollingRef.current.intervalId) {
          clearInterval(pollingRef.current.intervalId);
          pollingRef.current.intervalId = null;
        }
        completeCryptoPayment();
      } else if (status === 'failed') {
        if (pollingRef.current.intervalId) {
          clearInterval(pollingRef.current.intervalId);
          pollingRef.current.intervalId = null;
        }
        failCryptoPayment('juicyway_error');
      }
    }, 10000); // Poll every 10 seconds
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current.intervalId) {
        clearInterval(pollingRef.current.intervalId);
      }
    };
  }, []);

  const dismissCryptoModal = () => {
    setCryptoPaymentData(null);
    setCryptoVerificationStatus('idle');
    setIsVerifyingCrypto(false);
  };

  return {
    cryptoPaymentData,
    setCryptoPaymentData,
    isVerifyingCrypto,
    cryptoVerificationStatus,
    isInitializingCrypto: cryptoInitializer.isInitializing,
    initializeCryptoPayment,
    verifyCryptoPayment,
    dismissCryptoModal,
    cancelCryptoInitialization: cryptoInitializer.cancel,
  };
}
