import { toast } from '@/hooks/use-toast';
import type { CheckoutOrderItem } from '@/lib/checkout/build-order-items';
import { toCreditDirectItems } from '@/lib/checkout/credit-direct-items';
import { openCreditDirectCheckout } from '@/lib/credit-direct-client';
import { captureCheckoutPaymentFailed } from '../capture-checkout-payment-failed';
import { captureCreditDirectClientCompletion } from '../credit-direct-client-completion';
import { writeCreditDirectPopupMarker } from '../credit-direct-popup-return';
import { persistCreditDirectPopupReference } from '../persist-credit-direct-popup-reference';
import { buildCreditDirectVerificationPath } from './build-credit-direct-verification-path';
import type { CheckoutPaymentOrder } from './submit-checkout-order';

export interface OpenCheckoutCreditDirectOptions {
  merchantSlug: string;
  order: CheckoutPaymentOrder;
  amount: number;
  currency: string;
  orderNumber: string;
  total: number;
  customer: { email: string; name: string; phone: string };
  items: CheckoutOrderItem[];
  onPaymentStarted: (reference?: string) => void;
  onIdle: () => void;
  navigate: (path: string) => void;
}

/** Owns fresh-popup recovery, attribution and the server-verification handoff. */
export async function openCheckoutCreditDirect(
  {
    merchantSlug,
    order,
    amount,
    currency,
    orderNumber,
    total,
    customer,
    items,
    onPaymentStarted,
    onIdle,
    navigate,
  }: OpenCheckoutCreditDirectOptions,
  openCheckout: typeof openCreditDirectCheckout = openCreditDirectCheckout
): Promise<void> {
  let paymentStarted = false;
  let initializedReference: string | undefined;

  await openCheckout({
    merchantSlug,
    orderId: order.id,
    trackingToken: order.tracking_token ?? '',
    amount,
    customerEmail: customer.email,
    customerPhone: customer.phone,
    customerName: customer.name,
    // Canonical items preserve negotiated prices and zero-priced prize lines.
    items: toCreditDirectItems(items),
    onSuccess: ({ checkoutTransactionId, sessionId }) => {
      const completionMarker = captureCreditDirectClientCompletion({
        orderId: order.id,
        checkoutTransactionId,
        customerEmail: customer.email,
        sessionId,
        trackingToken: order.tracking_token,
      });
      // The SDK callback is evidence for verification, never proof of payment.
      navigate(
        buildCreditDirectVerificationPath({
          orderId: order.id,
          merchantSlug,
          completionMarker,
          trackingToken: order.tracking_token,
          customerEmail: customer.email,
        })
      );
    },
    onError: (error) => {
      console.error('Credit Direct error:', error);
      if (paymentStarted) {
        captureCheckoutPaymentFailed({
          currency,
          orderId: order.id,
          orderNumber,
          paymentMethod: 'credit_direct',
          reason: 'credit_direct_error',
          reference: initializedReference,
          total: order.total ?? total,
        });
      }
      toast({
        title: 'Credit Direct Failed',
        description:
          error || 'Credit Direct checkout failed. Please try again.',
        variant: 'destructive',
      });
      onIdle();
    },
    onClose: onIdle,
    onPopup: async ({ checkoutTransactionId, sessionId }) => {
      initializedReference = checkoutTransactionId || sessionId;
      paymentStarted = true;
      onPaymentStarted(initializedReference);
      writeCreditDirectPopupMarker(order.id, initializedReference);
      if (!checkoutTransactionId) return;
      try {
        await persistCreditDirectPopupReference(order, checkoutTransactionId);
      } catch (error) {
        console.error(
          'Failed to persist Credit Direct popup reference:',
          error instanceof Error ? error.message : error
        );
      }
    },
  });
}
