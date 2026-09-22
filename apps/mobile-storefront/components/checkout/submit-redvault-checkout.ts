import { saveRedvaultPurchaseTrackingContext } from '@/lib/claim-checkout-purchase-tracking';
import { persistPendingRedvaultOrder } from '@/lib/pending-redvault-order';
import type { ShippingAddressInput } from '@/lib/validation';
import type { createOrder } from '@/services/orders';
import type { CartItem } from '@/stores/cart-store';
import type { CheckoutSnapshot } from './checkout-order-builders';
import { runRedvaultSubmitInitializationSideEffects } from './checkout-submit-redvault';
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

export async function runRedvaultPostOrderBranch({
  accountPassword,
  address,
  checkoutGeneration,
  completedPaymentMethod,
  customer,
  customerEmail,
  customerName,
  customerPhone,
  isAuthenticated,
  itemsSnapshot,
  onRedvaultOrder,
  order,
  orderNumber,
  orderResponse,
  saveAsDefaultAddress,
  saveDetails,
  selectedPayment,
  selectedSavedAddressId,
  snapshot,
}: {
  accountPassword: UseCheckoutSubmitParams['accountPassword'];
  address: ShippingAddressInput;
  checkoutGeneration: string;
  completedPaymentMethod: string;
  customer: UseCheckoutSubmitParams['customer'];
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  isAuthenticated: UseCheckoutSubmitParams['isAuthenticated'];
  itemsSnapshot: CartItem[];
  onRedvaultOrder: RedvaultCallback | undefined;
  order: CreateOrderResult['order'];
  orderNumber: string;
  orderResponse: CreateOrderResult;
  saveAsDefaultAddress: UseCheckoutSubmitParams['saveAsDefaultAddress'];
  saveDetails: UseCheckoutSubmitParams['saveDetails'];
  selectedPayment: UseCheckoutSubmitParams['selectedPayment'];
  selectedSavedAddressId: UseCheckoutSubmitParams['selectedSavedAddressId'];
  snapshot: CheckoutSnapshot;
}): Promise<boolean> {
  // The REDVAULT leg persists its own durable retry identity and returns
  // before the shared finalize path runs.
  if (selectedPayment !== 'uba_redvault') {
    return false;
  }
  await submitRedvaultCheckout({
    checkoutGeneration,
    customerEmail,
    customerName,
    customerPhone,
    onInitializationSuccess: () =>
      runRedvaultSubmitInitializationSideEffects({
        accountPassword,
        address,
        customerEmail,
        customerId: customer?.id,
        isAuthenticated,
        orderId: order.id,
        saveAsDefaultAddress,
        saveDetails,
        selectedSavedAddressId,
        trackingToken: order.tracking_token ?? undefined,
      }),
    onRedvaultOrder,
    orderResponse,
    trackingContext: {
      customerEmail,
      customerPhone,
      items: itemsSnapshot,
      orderNumber,
      paymentMethod: completedPaymentMethod,
      shipping: snapshot.deliveryFee,
      subtotal: snapshot.subtotal,
      tax: snapshot.taxAmount,
      total: order.total,
      userId: customer?.id ?? undefined,
    },
  });
  return true;
}

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
