import type { MutableRefObject } from 'react';
import { releaseCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-release';
import {
  claimCheckoutPurchaseTracking,
  markCheckoutPurchaseEmitted,
  trackCreationPurchaseEmission,
} from '@/lib/claim-checkout-purchase-tracking';
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
  isMountedRef,
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
  isMountedRef?: MutableRefObject<boolean>;
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
    // Fire-and-forget, but a rejection rolls the claim back: the held
    // claim is the completion lane's "purchase already sent" signal, and
    // a failed emission must not pose as a recorded purchase or the
    // completion would emit the funnel without any ad purchase at all.
    const creationEmission = trackCheckoutRoutePurchaseCompleted({
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
    // Share the in-flight emission with the completion lane: the bare
    // claim reads held from this instant while the purchase above may
    // still be running, and a settlement landing in that window must
    // await it instead of trusting the claim.
    trackCreationPurchaseEmission(order.id, creationEmission);
    // Emission proof for crash recovery (mirrors the once-helper): a
    // successful emission stamps the bare purchase claim so a restart
    // after this point reads it as recorded at any age instead of
    // orphaning it for recovery after the lease window (which would
    // double-emit the ad purchase and order_completed). Failures keep
    // the current release behavior.
    void creationEmission.then(
      () => {
        void markCheckoutPurchaseEmitted(order.id);
      },
      () => {
        void releaseCheckoutPurchaseTracking(order.id);
      }
    );
  }
  // invoice_generated is captured on the order-success screen only after
  // the server confirms terminal artifact delivery (see
  // useInvoiceGeneratedCapture) — never optimistically here, where the
  // after() generation may still fail.
  // Completion attribution for the fallback emission lanes: if the
  // creation purchase above fails, the fully-paid / wallet-funded paths
  // emit the conversion instead and need identity, breakdown, and
  // currency now — the durable claim prevents a later richer retry.
  const finalizedCurrency =
    typeof orderResponse.order.currency === 'string' &&
    orderResponse.order.currency.trim() !== ''
      ? orderResponse.order.currency
      : undefined;
  await runFinalizeCheckoutPayment({
    attribution: {
      customerEmail,
      customerPhone,
      ...(user?.id ? { userId: user.id } : {}),
      items: itemsSnapshot,
      subtotal: snapshot.subtotal,
      shipping: snapshot.deliveryFee,
      tax: snapshot.taxAmount,
      ...(finalizedCurrency ? { currency: finalizedCurrency } : {}),
    },
    clearCart,
    customerEmail,
    customerName,
    customerPhone,
    isMountedRef,
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
