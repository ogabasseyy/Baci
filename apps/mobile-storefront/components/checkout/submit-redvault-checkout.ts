import { saveRedvaultPurchaseTrackingContext } from '@/lib/redvault-purchase-tracking-context';
import { persistPendingRedvaultOrder } from '@/lib/pending-redvault-order';
import type { createOrder } from '@/services/orders';
import type { UseCheckoutSubmitParams } from './use-checkout-submit.types';

type CreateOrderResult = Awaited<ReturnType<typeof createOrder>>;
type RedvaultCallback = NonNullable<UseCheckoutSubmitParams['onRedvaultOrder']>;
type TrackingContext = Parameters<
  typeof saveRedvaultPurchaseTrackingContext
>[1];

type SubmitRedvaultCheckoutInput = Readonly<{
  checkoutGeneration: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  onInitializationSuccess: () => void | Promise<void>;
  onRedvaultOrder: RedvaultCallback | undefined;
  orderResponse: CreateOrderResult;
  saveTracking?: typeof saveRedvaultPurchaseTrackingContext;
  trackingContext: TrackingContext;
}>;

export async function submitRedvaultCheckout({
  checkoutGeneration,
  customerEmail,
  customerName,
  customerPhone,
  onInitializationSuccess,
  onRedvaultOrder,
  orderResponse,
  saveTracking = saveRedvaultPurchaseTrackingContext,
  trackingContext,
}: SubmitRedvaultCheckoutInput) {
  // Durable fence first: the in-memory review is lost on app kill, and
  // an awaited tracking write ahead of this persist would leave a kill
  // window where the next submit cannot discover this order before a
  // different payment identity opens a second one.
  await persistPendingRedvaultOrder({
    orderId: orderResponse.order.id,
    checkoutGeneration,
    createdAt: new Date().toISOString(),
    ...(orderResponse.order.tracking_token
      ? { trackingToken: orderResponse.order.tracking_token }
      : {}),
    ...(customerEmail ? { customerEmail } : {}),
  });
  await saveTracking(orderResponse.order.id, trackingContext);
  onRedvaultOrder?.({
    orderResponse,
    customerEmail,
    customerName,
    customerPhone,
    onInitializationSuccess,
  });
}
