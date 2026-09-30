'use client';

import { deriveCheckoutPaymentBaseTotal } from '../derive-checkout-payment-base-total';
import { deriveCheckoutSummaryAmounts } from '../derive-checkout-summary-amounts';
import type { PendingCheckoutOrderSnapshot } from '../pending-checkout-order';
import type { DeliveryMethod, ResumedOrder } from '../types';
import { useCheckoutPaymentSession } from './use-checkout-payment-session';
import { useOrderTotals } from './use-order-totals';

interface UseCheckoutFinancialSessionOptions {
  merchant?: {
    vat_registration_status?: string | null;
    vat_rate?: number | null;
  } | null;
  effectiveItemSubtotal: number;
  effectiveCheckoutCartTotal: number;
  deliveryCost: number;
  deliveryMethod: DeliveryMethod | null;
  giftWrappingCost: number;
  hasCheckoutCartItems: boolean;
  resumedOrder: ResumedOrder | null;
  clearPendingCheckoutOrder: () => void;
  currencyCode: string;
  discountSubtotal: number;
  hasAuthenticatedUser: boolean;
  isOrderInFlightRef: { current: boolean };
  merchantSlug?: string;
  pendingCheckoutOrder: PendingCheckoutOrderSnapshot | null;
  walletSessionUserId?: string;
  resumeOrderId: string | null;
  preferredGateway: 'credpal' | 'credit_direct' | null;
}

/** Coordinates live and resumed order amounts with the checkout payment session. */
export function useCheckoutFinancialSession({
  merchant,
  effectiveItemSubtotal,
  effectiveCheckoutCartTotal,
  deliveryCost,
  deliveryMethod,
  giftWrappingCost,
  hasCheckoutCartItems,
  resumedOrder,
  clearPendingCheckoutOrder,
  currencyCode,
  discountSubtotal,
  hasAuthenticatedUser,
  isOrderInFlightRef,
  merchantSlug,
  pendingCheckoutOrder,
  walletSessionUserId,
  resumeOrderId,
  preferredGateway,
}: UseCheckoutFinancialSessionOptions) {
  const taxRate =
    merchant?.vat_registration_status === 'registered'
      ? (merchant.vat_rate ?? 7.5) / 100
      : 0;
  const orderTotals = useOrderTotals({
    cartTotal: effectiveItemSubtotal,
    deliveryCost,
    taxRate,
  });
  const paymentSession = useCheckoutPaymentSession({
    baseTotal: deriveCheckoutPaymentBaseTotal({
      effectiveCheckoutCartTotal,
      deliveryCost,
      giftWrappingCost,
      hasCheckoutCartItems,
      taxAmount: orderTotals?.taxAmount ?? 0,
      resumedOrderTotal: resumedOrder?.total ?? null,
    }),
    clearPendingCheckoutOrder,
    currencyCode,
    discountSubtotal,
    hasAuthenticatedUser,
    hasCheckoutCartItems,
    isOrderInFlightRef,
    merchantSlug,
    pendingCheckoutOrder,
    walletSessionUserId,
    resumeOrderId,
    preferredGateway,
    resumedOrder,
  });
  const summaryAmounts = deriveCheckoutSummaryAmounts({
    deliveryCost,
    deliveryMethod,
    discountAmount: paymentSession.checkoutValues.discountAmount,
    giftWrappingCost,
    hasCheckoutCartItems,
    orderTotals,
    resumedOrder,
  });

  return { orderTotals, paymentSession, summaryAmounts };
}
