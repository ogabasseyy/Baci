import type { MutableRefObject } from 'react';
import { claimCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-tracking';
import type { ShippingAddressInput } from '@/lib/validation';
import type { createOrder } from '@/services/orders';
import { trackCheckoutRoutePurchaseCompleted } from '@/services/tiktok-checkout-route-tracking';
import type { CartItem } from '@/stores/cart-store';
import type { CheckoutSnapshot } from './checkout-order-builders';
import { runCheckoutPostOrderSideEffects } from './checkout-post-order-side-effects';
import { runFinalizeCheckoutPayment } from './run-finalize-checkout-payment';
import type { UseCheckoutSubmitParams } from './use-checkout-submit.types';

type CreateOrderResult = Awaited<ReturnType<typeof createOrder>>;

export async function runCheckoutFinalization({
  accountPassword,
  address,
  clearCart,
  completedPaymentMethod,
  customer,
  customerEmail,
  customerName,
  customerPhone,
  isAuthenticated,
  isOrderInFlight,
  itemsSnapshot,
  order,
  orderNumber,
  orderResponse,
  saveAsDefaultAddress,
  saveDetails,
  selectedPayment,
  selectedSavedAddressId,
  setIsProcessing,
  setPendingOrder,
  setShowCryptoSelection,
  snapshot,
  user,
  walletFundedBankTransferOptionEnabled,
}: {
  accountPassword: UseCheckoutSubmitParams['accountPassword'];
  address: ShippingAddressInput;
  clearCart: UseCheckoutSubmitParams['clearCart'];
  completedPaymentMethod: string;
  customer: UseCheckoutSubmitParams['customer'];
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  isAuthenticated: UseCheckoutSubmitParams['isAuthenticated'];
  isOrderInFlight: MutableRefObject<boolean>;
  itemsSnapshot: CartItem[];
  order: CreateOrderResult['order'];
  orderNumber: string;
  orderResponse: CreateOrderResult;
  saveAsDefaultAddress: UseCheckoutSubmitParams['saveAsDefaultAddress'];
  saveDetails: UseCheckoutSubmitParams['saveDetails'];
  selectedPayment: Exclude<UseCheckoutSubmitParams['selectedPayment'], null>;
  selectedSavedAddressId: UseCheckoutSubmitParams['selectedSavedAddressId'];
  setIsProcessing: UseCheckoutSubmitParams['setIsProcessing'];
  setPendingOrder: UseCheckoutSubmitParams['setPendingOrder'];
  setShowCryptoSelection: UseCheckoutSubmitParams['setShowCryptoSelection'];
  snapshot: CheckoutSnapshot;
  user: UseCheckoutSubmitParams['user'];
  walletFundedBankTransferOptionEnabled: UseCheckoutSubmitParams['walletFundedBankTransferOptionEnabled'];
}): Promise<void> {
  // Purchase tracking claims first so a duplicate delivery of the same
  // order id never double-counts; finalization clears the cart only after
  // the payment route is confirmed.
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
  await runFinalizeCheckoutPayment({
    clearCart,
    customerEmail,
    customerName,
    customerPhone,
    isOrderInFlight,
    orderNumber,
    orderResponse,
    runPostOrderSideEffects: () => {
      void runCheckoutPostOrderSideEffects({
        accountPassword,
        address,
        customerEmail,
        customerId: customer?.id,
        isAuthenticated,
        saveAsDefaultAddress,
        saveDetails,
        selectedSavedAddressId,
      });
    },
    selectedPayment,
    setIsProcessing,
    setPendingOrder,
    setShowCryptoSelection,
    shouldCreateWalletFundedBankTransferOrder:
      walletFundedBankTransferOptionEnabled &&
      selectedPayment === 'bank_transfer',
  });
}
