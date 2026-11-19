import { fetchWithCsrf } from '@/lib/api-client';
import { checkoutFingerprintsMatch } from './checkout-fingerprints-match';
import {
  hasWalletCreditDirectOrder,
  resolveWalletCreditDirectFence,
} from './pending-checkout-credit-direct-fence';
import type {
  FencedCheckoutOrderIdentity,
  PendingCheckoutFingerprintInput,
  PendingCheckoutOrderItem,
  PendingCheckoutOrderSnapshot,
  ResolvePendingCheckoutOrderOptions,
  ResolvePendingCheckoutOrderResult,
  ReusedCheckoutOrder,
} from './pending-checkout-order.types';
import {
  clearOrderUnlessOxygenIsUnresolved,
  oxygenPreviousPaymentUnresolved,
  resolveOxygenCheckoutFence,
} from './pending-checkout-oxygen-fence';
import {
  fetchFencedOrderState,
  isNonReusableOrderState,
  isPaidOrderState,
  paidOrderIdentity,
  resolveRedvaultCheckoutFence,
  shouldClearStoredOrder,
} from './pending-checkout-redvault-fence';
import { recoverUnresolvedFundingOrder } from './pending-checkout-unresolved-funding';

export type {
  FencedCheckoutOrderIdentity,
  PendingCheckoutFingerprintInput,
  PendingCheckoutOrderItem,
  PendingCheckoutOrderSnapshot,
  ResolvePendingCheckoutOrderOptions,
  ResolvePendingCheckoutOrderResult,
  ReusedCheckoutOrder,
};

export { normalizeOrderPaymentMethod } from './normalize-order-payment-method';

export { buildPendingCheckoutFingerprint } from './checkout-fingerprint';

export const CHECKOUT_PENDING_ORDER_STORAGE_KEY =
  'storefront-checkout-pending-order';

export { unresolvedFundingOrderMessage } from './pending-checkout-unresolved-funding';

function normalizeText(value: string | null | undefined): string {
  return (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function resolvePendingCheckoutOrder({
  pendingOrder,
  merchantId,
  merchantSlug,
  customerEmail,
  checkoutFingerprint,
  paymentMethod,
  shippingProvider,
  selectedQuoteId,
  shippingRateId,
  fetchImpl = fetch,
}: ResolvePendingCheckoutOrderOptions): Promise<ResolvePendingCheckoutOrderResult> {
  const unresolvedRecovery = await recoverUnresolvedFundingOrder({
    pendingOrder,
    merchantId,
    merchantSlug: merchantSlug ?? undefined,
    customerEmail,
    checkoutFingerprint,
    paymentMethod,
    shippingProvider,
    selectedQuoteId,
    shippingRateId,
    fetchImpl,
  });
  if (unresolvedRecovery) return unresolvedRecovery;
  const oxygenFence = await resolveOxygenCheckoutFence({
    pendingOrder,
    merchantId,
    merchantSlug,
    customerEmail,
    checkoutFingerprint,
    paymentMethod,
    shippingProvider,
    selectedQuoteId,
    shippingRateId,
    fetchImpl,
  });
  if (oxygenFence) return oxygenFence;
  const creditDirectFence = await resolveWalletCreditDirectFence({ pendingOrder, merchantId, merchantSlug, customerEmail, checkoutFingerprint, paymentMethod, shippingProvider, selectedQuoteId, shippingRateId, fetchImpl });
  if (creditDirectFence) return creditDirectFence;
  // REDVAULT entry/exit validates the stored order against the server fence
  // first; a non-REDVAULT submission falls through to the ordinary flow.
  const redvaultFence = await resolveRedvaultCheckoutFence({
    fetchImpl,
    merchantSlug,
    paymentMethod,
    pendingOrder,
  });
  if (redvaultFence) {
    return redvaultFence;
  }
  if (!pendingOrder) {
    return { reusableOrder: null, clearStoredOrder: false };
  }

  const oxygenOrder =
    paymentMethod === 'oxygen' || pendingOrder.paymentMethod === 'oxygen' ||
    hasWalletCreditDirectOrder({ pendingOrder, merchantId, customerEmail, checkoutFingerprint, paymentMethod, shippingProvider });

  if (
    !pendingOrder.trackingToken ||
    pendingOrder.merchantId !== merchantId ||
    normalizeText(pendingOrder.customerEmail) !==
      normalizeText(customerEmail) ||
    !checkoutFingerprintsMatch(
      pendingOrder.checkoutFingerprint,
      checkoutFingerprint,
      pendingOrder.paymentMethod === 'oxygen' || pendingOrder.paymentMethod === 'credit_direct'
        ? pendingOrder.walletAmountUsed
        : undefined
    )
  ) {
    return { reusableOrder: null, clearStoredOrder: true };
  }

  const existingOrder = await fetchFencedOrderState({
    fetchImpl,
    merchantSlug,
    pendingOrder,
  });

  if (!existingOrder) {
    return clearOrderUnlessOxygenIsUnresolved(oxygenOrder);
  }

  // Same paid-fence rule as the REDVAULT branch: the stored order committed
  // money, so route to it instead of recreating from the unchanged cart.
  if (isPaidOrderState(existingOrder)) {
    return {
      reusableOrder: null,
      clearStoredOrder: true,
      paidOrder: paidOrderIdentity(pendingOrder, existingOrder),
    };
  }

  if (isNonReusableOrderState(existingOrder)) {
    return clearOrderUnlessOxygenIsUnresolved(oxygenOrder);
  }

  const mutationFetch = fetchImpl === fetch ? fetchWithCsrf : fetchImpl;

  const reuseResponse = await mutationFetch('/api/orders/reuse', {
    method: 'POST',
    body: JSON.stringify({
      order_id: pendingOrder.orderId,
      tracking_token: pendingOrder.trackingToken,
      merchant_id: merchantId,
      customer_email: customerEmail,
      payment_method: paymentMethod,
      shipping_provider: shippingProvider,
      selected_quote_id: selectedQuoteId || undefined,
      shipping_rate_id: shippingRateId || undefined,
    }),
  });

  if (!reuseResponse.ok) {
    const failure = await Promise.resolve()
      .then(() => reuseResponse.json())
      .catch(() => null);
    if (failure?.code === 'oxygen_payment_in_progress') {
      throw new Error('Your Oxygen payment is in progress. Return to your existing application or contact support before paying again.');
    }
    if (failure?.code === 'oxygen_previous_payment_unresolved') {
      throw new Error(oxygenPreviousPaymentUnresolved);
    }
    if (shouldClearStoredOrder(reuseResponse.status)) {
      return clearOrderUnlessOxygenIsUnresolved(oxygenOrder);
    }

    throw new Error('Failed to reopen pending checkout order');
  }

  const reusedOrderData = (await reuseResponse.json()) as {
    order?: ReusedCheckoutOrder;
  };

  if (!reusedOrderData.order?.id) {
    return clearOrderUnlessOxygenIsUnresolved(oxygenOrder);
  }

  return {
    reusableOrder: {
      order: reusedOrderData.order,
      amountDueToGateway:
        pendingOrder.amountDueToGateway ?? Number(existingOrder.total || 0),
    },
    clearStoredOrder: false,
  };
}
