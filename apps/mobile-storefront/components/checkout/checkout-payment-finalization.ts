import { router } from 'expo-router';
import type { MutableRefObject } from 'react';
import type { PaymentMethodType } from '@/components/checkout/PaymentMethodSelector';
import { getFullyPaidStoreCreditPaymentMethod } from '@/lib/wallet-payment-helpers';
import { trackCheckoutPaymentStarted } from '@/services/analytics';
import { OrderError, type OrderResponse } from '@/services/orders';
import type { CheckoutCompletionAttribution } from '@/services/track-checkout-payment-completed-once';
import { clearAndPersistCheckoutCart } from './checkout-cart-persistence';
import {
  routeFullyPaidPrizeSuccess,
  routeStoreCreditSuccess,
} from './checkout-fully-paid-routing';
import { initializeGatewayAndRoute } from './checkout-payment-initialize';
import type { PendingCryptoOrder } from './checkout-screen.constants';
import { startWalletFundedBankTransferCheckout } from './checkout-wallet-funded-bank-transfer';

interface FinalizeCheckoutPaymentParams {
  attribution?: CheckoutCompletionAttribution;
  clearCart: () => void | Promise<void>;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  isMountedRef?: MutableRefObject<boolean>;
  isOrderInFlight: MutableRefObject<boolean>;
  orderNumber: string;
  orderResponse: OrderResponse;
  runPostOrderSideEffects: () => void;
  selectedPayment: PaymentMethodType;
  setIsProcessing: (value: boolean) => void;
  setPendingOrder: (value: PendingCryptoOrder | null) => void;
  setShowCryptoSelection: (value: boolean) => void;
  shouldCreateWalletFundedBankTransferOrder: boolean;
}

export async function finalizeCheckoutPayment({
  attribution,
  clearCart,
  customerEmail,
  customerName,
  customerPhone,
  isMountedRef,
  isOrderInFlight,
  orderNumber,
  orderResponse,
  runPostOrderSideEffects,
  selectedPayment,
  setIsProcessing,
  setPendingOrder,
  setShowCryptoSelection,
  shouldCreateWalletFundedBankTransferOrder,
}: FinalizeCheckoutPaymentParams) {
  if (selectedPayment === 'uba_redvault')
    throw new OrderError(
      'Review the server UBA summary before payment',
      'REDVAULT_REVIEW_REQUIRED'
    );
  const { order } = orderResponse;
  const fullyPaidStoreCreditPaymentMethod =
    getFullyPaidStoreCreditPaymentMethod(orderResponse);

  // Fully-paid orders route to success BEFORE any payment-method branch
  // (including Juicyway crypto): once nothing is due to the gateway, the
  // selected method is irrelevant and starting a payment flow for ₦0 is wrong.
  if (fullyPaidStoreCreditPaymentMethod) {
    await routeStoreCreditSuccess({
      attribution,
      clearCart,
      isMountedRef,
      orderId: order.id,
      orderNumber,
      orderResponse,
      paymentMethod: fullyPaidStoreCreditPaymentMethod,
      setIsProcessing,
      trackingToken: order.tracking_token,
    });
    isOrderInFlight.current = false;
    runPostOrderSideEffects();
    return;
  }

  // A quiz prize (voucher) order is pre-reserved and comes back already paid
  // with nothing due and no wallet/savings usage — so the store-credit check
  // above returns undefined. Route straight to success.
  if (
    order?.payment_status === 'paid' &&
    Number(orderResponse.amountDueToGateway ?? 0) <= 0
  ) {
    // routeFullyPaidPrizeSuccess reports the actual voucher method (not the
    // stale UI selection), so the success screen shows paid/completed copy.
    await routeFullyPaidPrizeSuccess({
      attribution,
      clearCart,
      isMountedRef,
      isOrderInFlight,
      orderId: order.id,
      orderNumber,
      orderTotal: order.total,
      setIsProcessing,
      trackingToken: order.tracking_token,
    });
    runPostOrderSideEffects();
    return;
  }

  if (selectedPayment === 'juicyway') {
    // The crypto selector opens next; payment_started is recorded once the
    // provider initializes (see runCryptoPaymentInitialization), never here.
    setPendingOrder({
      order,
      orderResponse,
      customerEmail,
      customerName,
      customerPhone,
      trackingToken: order.tracking_token || undefined,
    });
    setIsProcessing(false);
    isOrderInFlight.current = false;
    setShowCryptoSelection(true);
    runPostOrderSideEffects();
    return;
  }

  const isOnlinePayment =
    selectedPayment === 'paystack' || selectedPayment === 'korapay';
  const isBankTransfer = selectedPayment === 'bank_transfer';

  if (isOnlinePayment || isBankTransfer) {
    if (isBankTransfer && shouldCreateWalletFundedBankTransferOrder) {
      const walletFundedIntentId = await startWalletFundedBankTransferCheckout({
        attribution,
        isOrderInFlight,
        orderId: order.id,
        orderNumber,
        orderTotal: order.total,
        setIsProcessing,
        trackingToken: order.tracking_token,
      });
      if (walletFundedIntentId) {
        // The transfer setup succeeded: record the start now, never before,
        // stamped with the created intent so a recreated intent for the
        // same order reconciles instead of merging with the first start.
        await trackCheckoutPaymentStarted({
          orderId: order.id,
          orderNumber,
          paymentMethod: selectedPayment,
          reference: walletFundedIntentId,
          value: orderResponse.amountDueToGateway,
        });
        runPostOrderSideEffects();
        return;
      }
    }

    await initializeGatewayAndRoute({
      customerEmail,
      customerName,
      customerPhone,
      orderId: order.id,
      orderNumber,
      orderResponse,
      selectedPayment,
      setIsProcessing,
      trackingToken: order.tracking_token,
    });
    isOrderInFlight.current = false;
    runPostOrderSideEffects();
    return;
  }

  await clearAndPersistCheckoutCart(clearCart);
  isOrderInFlight.current = false;
  router.replace({
    pathname: '/order-success',
    params: {
      orderId: order.id,
      orderNumber,
      paymentMethod: selectedPayment,
      ...(order.tracking_token && {
        trackingToken: order.tracking_token,
      }),
    },
  });
  runPostOrderSideEffects();
}
