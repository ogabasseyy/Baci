'use client';

import { useRouter } from 'next/navigation';
import { asRoute } from '@/lib/routes';
import { captureCheckoutPaymentCompleted } from '../capture-checkout-payment-completed';
import { clearCheckoutIdempotencyKey } from '../checkout-idempotency';
import type { WalletFundedOrderPaidPayload } from './use-wallet-funded-bank-transfer';

/**
 * Completes a server-confirmed wallet-funded order. The cart clear remains
 * delayed to preserve the existing transition behavior while the success route
 * reads the completed order independently of cart state.
 */
export function useWalletFundedOrderCompletion({
  clearCart,
  clearCheckoutSession,
  clearPendingCheckoutOrder,
  getHref,
  paymentMethod,
  routerPush,
}: {
  clearCart: () => void;
  clearCheckoutSession: () => void;
  clearPendingCheckoutOrder: () => void;
  getHref: (path: string) => string;
  paymentMethod: string;
  routerPush?: (url: string) => void;
}) {
  const router = useRouter();
  const push = routerPush ?? ((url: string) => router.push(asRoute(url)));

  return ({
    checkoutFingerprint,
    currency,
    intentId,
    orderId,
    orderNumber,
    total,
    trackingToken,
  }: WalletFundedOrderPaidPayload) => {
    captureCheckoutPaymentCompleted({
      currency,
      orderId,
      ...(orderNumber ? { orderNumber } : {}),
      paymentMethod,
      reference: intentId,
      total,
    });
    clearPendingCheckoutOrder();
    void clearCheckoutIdempotencyKey(checkoutFingerprint);
    clearCheckoutSession();
    const successQuery = new URLSearchParams({ orderId, wallet: 'true' });
    if (trackingToken) {
      successQuery.set('trackingToken', trackingToken);
    }
    push(getHref(`/order-success?${successQuery.toString()}`));
    setTimeout(clearCart, 500);
  };
}
