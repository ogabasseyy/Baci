import type { PaymentMethodType } from '@/components/checkout/PaymentMethodSelector';
import { claimCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-tracking';
import type { ShippingAddressInput } from '@/lib/validation';
import { getFullyPaidStoreCreditPaymentMethod } from '@/lib/wallet-payment-helpers';
import type { OrderResponse } from '@/services/orders';
import { trackCheckoutRoutePurchaseCompleted } from '@/services/tiktok-checkout-route-tracking';
import type { CartItem } from '@/stores/cart-store';
import { maybeClaimCheckoutInvoice } from './checkout-invoice-claim';
import type { CheckoutSnapshot } from './checkout-order-builders';
import { runRedvaultSubmitInitializationSideEffects } from './checkout-submit-redvault';
import { submitRedvaultCheckout } from './submit-redvault-checkout';
import type { UseCheckoutSubmitParams } from './use-checkout-submit.types';

interface HandleCreatedCheckoutOrderParams {
  accountPassword: string;
  address: ShippingAddressInput;
  checkoutGeneration: string;
  customer: UseCheckoutSubmitParams['customer'];
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  isAuthenticated: boolean;
  itemsSnapshot: CartItem[];
  onRedvaultOrder: UseCheckoutSubmitParams['onRedvaultOrder'];
  orderResponse: OrderResponse;
  saveAsDefaultAddress: boolean;
  saveDetails: boolean;
  selectedPayment: PaymentMethodType;
  selectedSavedAddressId: string | null;
  snapshot: CheckoutSnapshot;
  user: UseCheckoutSubmitParams['user'];
}

export interface HandledCreatedCheckoutOrder {
  handled: boolean;
  orderNumber: string;
}

/**
 * Post-creation routing for a committed order: invoice claiming, the
 * REDVAULT initialization flow, and the once-guarded ad-platform
 * purchase signal. Returns handled=true when REDVAULT took over and
 * the caller must stop before payment finalization.
 */
export async function handleCreatedCheckoutOrder({
  accountPassword,
  address,
  checkoutGeneration,
  customer,
  customerEmail,
  customerName,
  customerPhone,
  isAuthenticated,
  itemsSnapshot,
  onRedvaultOrder,
  orderResponse,
  saveAsDefaultAddress,
  saveDetails,
  selectedPayment,
  selectedSavedAddressId,
  snapshot,
  user,
}: HandleCreatedCheckoutOrderParams): Promise<HandledCreatedCheckoutOrder> {
  const { order } = orderResponse;
  const completedPaymentMethod =
    getFullyPaidStoreCreditPaymentMethod(orderResponse) ?? selectedPayment;
  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();
  await maybeClaimCheckoutInvoice({
    selectedPayment,
    order,
    orderNumber,
    itemsSnapshot,
  });
  if (selectedPayment === 'uba_redvault') {
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
    return { handled: true, orderNumber };
  }
  if (await claimCheckoutPurchaseTracking(order.id)) {
    void trackCheckoutRoutePurchaseCompleted({
      customerEmail,
      customerPhone,
      items: itemsSnapshot,
      orderId: order.id,
      orderNumber,
      paymentMethod: completedPaymentMethod,
      shipping: snapshot.deliveryFee,
      subtotal: snapshot.subtotal,
      tax: snapshot.taxAmount,
      total: order.total,
      userId: user?.id ?? undefined,
    });
  }
  return { handled: false, orderNumber };
}
