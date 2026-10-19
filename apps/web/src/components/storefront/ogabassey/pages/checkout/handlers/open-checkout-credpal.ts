import { openCredPalCheckout } from '@/lib/credpal';
import type { CheckoutPaymentOrder } from './submit-checkout-order';

export interface OpenCheckoutCredpalOptions {
  key?: string;
  amount: number;
  product: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  order: CheckoutPaymentOrder;
  checkoutFingerprint: string;
  onPaymentStarted: () => void;
  paymentStarted: () => boolean;
  onPaymentCompleted: (reference: string) => void;
  onPaymentFailed: () => void;
  clearPendingCheckoutOrder: () => void;
  clearCheckoutIdempotencyKey: (fingerprint: string) => Promise<void>;
  clearCheckoutSession: () => void;
  clearCart: () => void;
  navigate: (path: string) => void;
  onUnavailable: () => void;
  onError: (error: { success: false; message: string }) => void;
  releaseSubmitLock: () => void;
  openCheckout?: typeof openCredPalCheckout;
}

/** Runs CredPal's widget callbacks after the checkout order already exists. */
export async function openCheckoutCredpal({
  key,
  amount,
  product,
  customerEmail,
  customerName,
  customerPhone,
  order,
  checkoutFingerprint,
  onPaymentStarted,
  paymentStarted,
  onPaymentCompleted,
  onPaymentFailed,
  clearPendingCheckoutOrder,
  clearCheckoutIdempotencyKey,
  clearCheckoutSession,
  clearCart,
  navigate,
  onUnavailable,
  onError,
  releaseSubmitLock,
  openCheckout = openCredPalCheckout,
}: OpenCheckoutCredpalOptions): Promise<void> {
  if (!key) {
    onUnavailable();
    releaseSubmitLock();
    return;
  }

  await openCheckout({
    key,
    amount,
    product,
    customerEmail,
    customerName,
    customerPhone,
    onLoad: onPaymentStarted,
    onSuccess: async (data) => {
      if (data.status === 'success') {
        onPaymentCompleted(data.order_no);
      }
      clearPendingCheckoutOrder();
      await clearCheckoutIdempotencyKey(checkoutFingerprint);
      clearCheckoutSession();
      clearCart();
      const query = new URLSearchParams({
        type: 'credpal',
        orderId: order.id,
        credpalRef: data.order_no,
      });
      if (data.status) {
        query.set('credpalStatus', data.status);
      }
      if (order.tracking_token) {
        query.set('trackingToken', order.tracking_token);
      }
      navigate(`/order-success?${query.toString()}`);
    },
    onError: (error) => {
      if (paymentStarted()) {
        onPaymentFailed();
      }
      onError(error);
      releaseSubmitLock();
    },
    onClose: releaseSubmitLock,
  });
}
