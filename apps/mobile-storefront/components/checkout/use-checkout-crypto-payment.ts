import type { MutableRefObject } from 'react';
import { useState } from 'react';
import { Alert } from 'react-native';
import { trackCheckoutPaymentStarted } from '@/services/analytics';
import { OrderError } from '@/services/orders';
import {
  CHECKOUT_API_BASE_URL,
  CHECKOUT_MERCHANT_ID,
  type PendingCryptoOrder,
} from './checkout-screen.constants';

const CRYPTO_PAYMENT_INIT_TIMEOUT_MS = 10_000;

export interface CryptoPaymentState {
  orderId: string;
  orderNumber: string;
  address: string;
  chain: string;
  currency: string;
  amount: number;
  cryptoAmount: string;
  confirmationTime: string;
  reference: string;
  paymentId: string;
  trackingToken?: string;
}

interface UseCheckoutCryptoPaymentParams {
  isOrderInFlight: MutableRefObject<boolean>;
  setIsProcessing: (value: boolean) => void;
  total: number;
}

interface CryptoInitializeResponse {
  success?: boolean;
  error?: string;
  reference?: string;
  crypto_payment?: {
    address?: string;
    amount?: number;
    chain?: string;
    confirmation_time?: string;
    crypto_amount?: string;
    currency?: string;
    payment_id?: string;
  };
}

function toCryptoInitializeResponse(value: unknown): CryptoInitializeResponse {
  return value && typeof value === 'object'
    ? (value as CryptoInitializeResponse)
    : {};
}

interface RunCryptoPaymentInitializationParams {
  chain: string;
  currency: string;
  isOrderInFlight: MutableRefObject<boolean>;
  pendingOrder: PendingCryptoOrder;
  setCryptoPayment: (value: CryptoPaymentState | null) => void;
  setIsProcessing: (value: boolean) => void;
  setPendingOrder: (value: PendingCryptoOrder | null) => void;
  setShowCryptoSelection: (value: boolean) => void;
}

// Module-scope helper: keeping the try/finally and throw-in-try statements out
// of the hook body lets React Compiler memoize useCheckoutCryptoPayment.
async function runCryptoPaymentInitialization({
  chain,
  currency,
  isOrderInFlight,
  pendingOrder,
  setCryptoPayment,
  setIsProcessing,
  setPendingOrder,
  setShowCryptoSelection,
}: RunCryptoPaymentInitializationParams): Promise<void> {
  try {
    const {
      order,
      orderResponse,
      customerEmail,
      customerName,
      customerPhone,
      trackingToken,
    } = pendingOrder;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      CRYPTO_PAYMENT_INIT_TIMEOUT_MS
    );
    let initResponse: Response;
    try {
      initResponse = await fetch(
        `${CHECKOUT_API_BASE_URL}/api/payments/initialize`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `crypto-init-${order.id}-${chain}-${currency}`,
          },
          body: JSON.stringify({
            merchant_id: CHECKOUT_MERCHANT_ID,
            order_id: order.id,
            currency: 'NGN',
            customer_email: customerEmail,
            customer_name: customerName,
            customer_phone: customerPhone,
            gateway: 'juicyway',
            crypto_chain: chain,
            crypto_currency: currency,
          }),
        }
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new OrderError(
          'Payment initialization timed out',
          'PAYMENT_INIT_TIMEOUT'
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    const initData = toCryptoInitializeResponse(await initResponse.json());

    if (!initResponse.ok || !initData.success) {
      throw new OrderError(
        initData.error || 'Failed to initialize crypto payment',
        'PAYMENT_INIT_ERROR'
      );
    }
    const payment = initData.crypto_payment;
    if (!payment?.address) {
      throw new OrderError(
        'Failed to generate crypto wallet address. Please try again.',
        'PAYMENT_INIT_ERROR'
      );
    }

    // The provider initialized with a wallet address: record the start now,
    // stamped with the initialized reference (payment ID fallback) so a
    // retry on another network or coin reconciles to its own attempt
    // instead of blending into an indistinguishable same-order start.
    await trackCheckoutPaymentStarted({
      orderId: order.id,
      orderNumber: order.order_number || order.id.slice(0, 8).toUpperCase(),
      paymentMethod: 'juicyway',
      reference: initData.reference || payment.payment_id || undefined,
      value: orderResponse.amountDueToGateway,
    });
    setIsProcessing(false);
    setShowCryptoSelection(false);
    isOrderInFlight.current = false;
    setCryptoPayment({
      orderId: order.id,
      orderNumber: order.order_number || order.id.slice(0, 8).toUpperCase(),
      address: payment.address,
      chain: payment.chain || chain,
      currency: payment.currency || currency,
      amount: payment.amount || orderResponse.amountDueToGateway,
      cryptoAmount: payment.crypto_amount || '',
      confirmationTime: payment.confirmation_time || '',
      // Canonical provider-attempt reference, shared by the start event
      // above and the completion handoff: when initialization returns a
      // payment ID but no top-level reference, the payment ID is the
      // attempt identity — without it settlement polling could emit the
      // completion but never reconcile it to its start.
      reference: initData.reference || payment.payment_id || '',
      paymentId: payment.payment_id || '',
      trackingToken,
    });
  } catch (error) {
    setIsProcessing(false);
    setShowCryptoSelection(false);
    isOrderInFlight.current = false;
    Alert.alert(
      error instanceof OrderError ? 'Payment Error' : 'Error',
      error instanceof OrderError
        ? error.message
        : 'Failed to initialize payment'
    );
  } finally {
    setPendingOrder(null);
  }
}

export function useCheckoutCryptoPayment({
  isOrderInFlight,
  setIsProcessing,
  total,
}: UseCheckoutCryptoPaymentParams) {
  const [showCryptoSelection, setShowCryptoSelection] = useState(false);
  const [cryptoPayment, setCryptoPayment] = useState<CryptoPaymentState | null>(
    null
  );
  const [pendingOrder, setPendingOrder] = useState<PendingCryptoOrder | null>(
    null
  );

  const handleCryptoConfirm = async (chain: string, currency: string) => {
    if (!pendingOrder) return;

    const { orderResponse: pendingResponse } = pendingOrder;
    if (pendingResponse.amountDueToGateway !== total) {
      Alert.alert(
        'Amount Changed',
        'Your order total has changed since the order was created. Please go back and try again.',
        [{ text: 'OK' }]
      );
      setPendingOrder(null);
      setShowCryptoSelection(false);
      return;
    }

    setIsProcessing(true);
    await runCryptoPaymentInitialization({
      chain,
      currency,
      isOrderInFlight,
      pendingOrder,
      setCryptoPayment,
      setIsProcessing,
      setPendingOrder,
      setShowCryptoSelection,
    });
  };

  return {
    cryptoPayment,
    handleCryptoConfirm,
    setCryptoPayment,
    setPendingOrder,
    setShowCryptoSelection,
    showCryptoSelection,
  };
}
