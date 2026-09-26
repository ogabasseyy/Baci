import { captureCheckoutPaymentCompleted } from '../capture-checkout-payment-completed';
import { clearCheckoutIdempotencyKey } from '../checkout-idempotency';
import type { CheckoutPaymentOrder } from './submit-checkout-order';

export type CheckoutCompletion =
  | {
      kind: 'zero_due';
      paymentMethod: string;
      currency: string;
      orderNumber: string;
      total: number;
    }
  | { kind: 'invoice' }
  | { kind: 'payforme'; payerName: string }
  | { kind: 'standard' };

interface CompleteCheckoutOrderOptions {
  order: CheckoutPaymentOrder;
  checkoutFingerprint: string;
  completion: CheckoutCompletion;
  clearPendingCheckoutOrder: () => void;
  clearCheckoutSession: () => void;
  clearCart: () => void;
  pushSuccessRoute: (path: string) => void;
}

/** Completes paths that do not open a provider, preserving recovery cleanup. */
export async function completeCheckoutOrder({
  order,
  checkoutFingerprint,
  completion,
  clearPendingCheckoutOrder,
  clearCheckoutSession,
  clearCart,
  pushSuccessRoute,
}: CompleteCheckoutOrderOptions): Promise<void> {
  // Zero due alone is not payment proof. A server-paid order can attribute
  // coverage to wallet/savings/voucher, rather than the UI's gateway choice.
  if (completion.kind === 'zero_due' && order.payment_status === 'paid') {
    captureCheckoutPaymentCompleted({
      currency: completion.currency,
      orderId: order.id,
      orderNumber: completion.orderNumber,
      paymentMethod: order.payment_method || completion.paymentMethod,
      total: order.total ?? completion.total,
    });
  }
  // Invoice generation/delivery is confirmed downstream, never on this handoff.
  clearPendingCheckoutOrder();
  await clearCheckoutIdempotencyKey(checkoutFingerprint);
  clearCheckoutSession();

  const query =
    completion.kind === 'zero_due'
      ? new URLSearchParams({ orderId: order.id, wallet: 'true' })
      : new URLSearchParams({ type: completion.kind, orderId: order.id });
  if (completion.kind === 'payforme')
    query.set('payerName', completion.payerName);
  if (order.tracking_token) query.set('trackingToken', order.tracking_token);

  pushSuccessRoute(`/order-success?${query.toString()}`);
  // Avoid rendering an empty-cart screen before the route change commits.
  setTimeout(clearCart, 500);
}
