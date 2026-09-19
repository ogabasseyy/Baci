import { router } from 'expo-router';
import type { MutableRefObject } from 'react';
import type { StoreCreditPaymentMethod } from '@/lib/wallet-payment-helpers';
import { trackCheckoutPaymentCompletedOnce } from '@/services/analytics';
import type { OrderResponse } from '@/services/orders';
import type { CheckoutCompletionAttribution } from '@/services/track-checkout-payment-completed-once';
import { clearAndPersistCheckoutCart } from './checkout-cart-persistence';

/**
 * Route a wallet/savings fully-paid order to the success screen, surfacing the
 * store-credit amounts used so the receipt can show them.
 */
export async function routeStoreCreditSuccess({
  attribution,
  clearCart,
  orderId,
  orderNumber,
  orderResponse,
  paymentMethod,
  setIsProcessing,
  trackingToken,
}: {
  attribution?: CheckoutCompletionAttribution;
  clearCart: () => void | Promise<void>;
  orderId: string;
  orderNumber: string;
  orderResponse: OrderResponse;
  paymentMethod: StoreCreditPaymentMethod;
  setIsProcessing: (value: boolean) => void;
  trackingToken?: string | null;
}) {
  // Fully-paid orders bypass the gateway completion handlers: record the
  // conversion here before the cart is cleared (purchase capture needs items).
  const paidTotal = orderResponse.order.total;
  // First completion wins the durable claim; replays emit nothing.
  await trackCheckoutPaymentCompletedOnce({
    ...attribution,
    orderId,
    orderNumber,
    paymentMethod,
    value: paidTotal,
  });
  await clearAndPersistCheckoutCart(clearCart);
  setIsProcessing(false);
  router.replace({
    pathname: '/order-success',
    params: {
      orderId,
      orderNumber,
      paymentMethod,
      savingsAmountUsed: String(orderResponse.savings?.amountUsed ?? 0),
      walletAmountUsed: String(orderResponse.wallet?.amountUsed ?? 0),
      ...(trackingToken && {
        trackingToken,
      }),
    },
  });
}

/**
 * Route an order that is already fully paid with nothing due to the gateway —
 * e.g. a pre-reserved quiz prize (voucher) order — straight to success. No
 * payment-method flow applies: initializing a gateway (or crypto/bank) for a ₦0
 * order would fail or wrongly start a payment for a free prize.
 */
export async function routeFullyPaidPrizeSuccess({
  attribution,
  clearCart,
  isOrderInFlight,
  orderId,
  orderNumber,
  orderTotal,
  setIsProcessing,
  trackingToken,
}: {
  attribution?: CheckoutCompletionAttribution;
  clearCart: () => void | Promise<void>;
  isOrderInFlight: MutableRefObject<boolean>;
  orderId: string;
  orderNumber: string;
  orderTotal: number;
  setIsProcessing: (value: boolean) => void;
  trackingToken?: string | null;
}) {
  // Prize orders bypass every completion handler: record the conversion here
  // before the cart is cleared (purchase capture needs items).
  // First completion wins the durable claim; replays emit nothing.
  await trackCheckoutPaymentCompletedOnce({
    ...attribution,
    orderId,
    orderNumber,
    paymentMethod: 'quiz_voucher',
    value: orderTotal,
  });
  await clearAndPersistCheckoutCart(clearCart);
  setIsProcessing(false);
  isOrderInFlight.current = false;
  router.replace({
    pathname: '/order-success',
    params: {
      orderId,
      orderNumber,
      // The prize is settled by the voucher — always report the actual method so
      // the success screen shows paid/completed copy, not the stale UI selection
      // (e.g. invoice/payforme, which render pending payment-request copy).
      paymentMethod: 'quiz_voucher',
      ...(trackingToken && {
        trackingToken,
      }),
    },
  });
}
