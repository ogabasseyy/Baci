import type { ShippingAddressInput } from '@/lib/validation';
import type { createOrder } from '@/services/orders';
import type { CartItem } from '@/stores/cart-store';
import type { CheckoutSnapshot } from './checkout-order-builders';
import { runRedvaultSubmitInitializationSideEffects } from './checkout-submit-redvault';
import {
  type RedvaultCallback,
  submitRedvaultCheckout,
} from './submit-redvault-checkout';
import type { UseCheckoutSubmitParams } from './use-checkout-submit.types';

type CreateOrderResult = Awaited<ReturnType<typeof createOrder>>;

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
