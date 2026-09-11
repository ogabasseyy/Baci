import { router } from 'expo-router';
import type { MutableRefObject } from 'react';
import type { StoreCreditPaymentMethod } from '@/lib/wallet-payment-helpers';
import type { OrderResponse } from '@/services/orders';
import { clearAndPersistCheckoutCart } from './checkout-cart-persistence';

/**
 * Route a wallet/savings fully-paid order to the success screen, surfacing the
 * store-credit amounts used so the receipt can show them.
 */
export async function routeStoreCreditSuccess({
  clearCart,
  orderId,
  orderNumber,
  orderResponse,
  paymentMethod,
  setIsProcessing,
  trackingToken,
}: {
  clearCart: () => void | Promise<void>;
  orderId: string;
  orderNumber: string;
  orderResponse: OrderResponse;
  paymentMethod: StoreCreditPaymentMethod;
  setIsProcessing: (value: boolean) => void;
  trackingToken?: string | null;
}) {
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
  clearCart,
  isOrderInFlight,
  orderId,
  orderNumber,
  setIsProcessing,
  trackingToken,
}: {
  clearCart: () => void | Promise<void>;
  isOrderInFlight: MutableRefObject<boolean>;
  orderId: string;
  orderNumber: string;
  setIsProcessing: (value: boolean) => void;
  trackingToken?: string | null;
}) {
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
