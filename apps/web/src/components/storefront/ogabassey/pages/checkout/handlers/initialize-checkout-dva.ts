import {
  type DvaBillingAddress,
  requestDvaInitialization,
} from '../checkout-page-data-loaders';
import type { DvaModalData } from '../hooks/use-dva-confirm-transfer';
import type { CheckoutPaymentOrder } from './submit-checkout-order';

export interface InitializeCheckoutDvaOptions {
  merchantId: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  checkoutFingerprint?: string;
  billingAddress: DvaBillingAddress;
  currencyCode: string;
  paymentAmount: number;
  total: number;
  order: CheckoutPaymentOrder;
  setDvaData: (data: DvaModalData) => void;
  setDvaCountdown: (seconds: number) => void;
  setIsProcessing: (value: boolean) => void;
  setIsInitializingDva: (value: boolean) => void;
  releaseSubmitLock: () => void;
  onDvaReady?: (reference?: string) => void;
  onPaymentFailure: () => void;
  onError: (error: unknown) => void;
  requestDva?: typeof requestDvaInitialization;
}

function orderCurrency(order: CheckoutPaymentOrder, fallback: string): string {
  return typeof order.currency === 'string' && order.currency.trim()
    ? order.currency.trim().toUpperCase()
    : fallback;
}

/** Initializes the DVA rail and preserves its payment-attempt lifecycle. */
export async function initializeCheckoutDva({
  merchantId,
  customerEmail,
  customerName,
  customerPhone,
  checkoutFingerprint,
  billingAddress,
  currencyCode,
  paymentAmount,
  total,
  order,
  setDvaData,
  setDvaCountdown,
  setIsProcessing,
  setIsInitializingDva,
  releaseSubmitLock,
  onDvaReady,
  onPaymentFailure,
  onError,
  requestDva = requestDvaInitialization,
}: InitializeCheckoutDvaOptions): Promise<void> {
  setIsInitializingDva(true);
  const stampedCurrency = orderCurrency(order, currencyCode);
  await requestDva({
    merchantId,
    orderId: order.id,
    customerEmail,
    customerName,
    customerPhone,
    billingAddress,
    orderCurrency: stampedCurrency,
  })
    .then((result) => {
      setDvaData({
        ...result.dva,
        amount: paymentAmount,
        total: order.total ?? total,
        reference: result.reference,
        orderId: order.id,
        orderNumber: order.order_number,
        trackingToken: order.tracking_token,
        checkoutFingerprint,
        orderCurrency: stampedCurrency,
      });
      setDvaCountdown(3600);
      onDvaReady?.(result.reference);
      releaseSubmitLock();
    })
    .catch((error: unknown) => {
      onPaymentFailure();
      onError(error);
      releaseSubmitLock();
    })
    .finally(() => {
      setIsProcessing(false);
      setIsInitializingDva(false);
    });
}
