import { saveRedvaultPurchaseTrackingContext } from '@/lib/claim-checkout-purchase-tracking';
import type { createOrder } from '@/services/orders';
import type { UseCheckoutSubmitParams } from './use-checkout-submit.types';

type CreateOrderResult = Awaited<ReturnType<typeof createOrder>>;
type RedvaultCallback = NonNullable<UseCheckoutSubmitParams['onRedvaultOrder']>;
type TrackingContext = Parameters<
  typeof saveRedvaultPurchaseTrackingContext
>[1];

type SubmitRedvaultCheckoutInput = Readonly<{
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  onInitializationSuccess: () => void;
  onRedvaultOrder: RedvaultCallback | undefined;
  orderResponse: CreateOrderResult;
  saveTracking?: typeof saveRedvaultPurchaseTrackingContext;
  trackingContext: TrackingContext;
}>;

export async function submitRedvaultCheckout({
  customerEmail,
  customerName,
  customerPhone,
  onInitializationSuccess,
  onRedvaultOrder,
  orderResponse,
  saveTracking = saveRedvaultPurchaseTrackingContext,
  trackingContext,
}: SubmitRedvaultCheckoutInput) {
  await saveTracking(orderResponse.order.id, trackingContext);
  onRedvaultOrder?.({
    orderResponse,
    customerEmail,
    customerName,
    customerPhone,
    onInitializationSuccess,
  });
}
