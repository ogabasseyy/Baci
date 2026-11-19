import { fetchWithCsrf } from '@/lib/api-client';
import { checkoutFingerprintsMatch } from './checkout-fingerprints-match';
import type {
  PendingCheckoutOrderSnapshot,
  ResolvePendingCheckoutOrderResult,
  ReusedCheckoutOrder,
} from './pending-checkout-order.types';
import { oxygenPreviousPaymentUnresolved } from './pending-checkout-oxygen-fence';
import {
  fetchFencedOrderState,
  isNonReusableOrderState,
  isPaidOrderState,
  paidOrderIdentity,
} from './pending-checkout-redvault-fence';

export const unresolvedFundingOrderMessage =
  'Your previous order has a pending store-credit verification. Please wait for reconciliation or contact support before starting another payment.';

function normalizeText(value: string | null | undefined): string {
  return (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface RecoverUnresolvedFundingOrderOptions {
  pendingOrder: PendingCheckoutOrderSnapshot | null | undefined;
  merchantId: string;
  merchantSlug?: string;
  customerEmail: string;
  checkoutFingerprint: string;
  paymentMethod: string;
  shippingProvider: string | null;
  selectedQuoteId?: string;
  shippingRateId?: string | null;
  fetchImpl?: typeof fetch;
}

export async function recoverUnresolvedFundingOrder({
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
}: RecoverUnresolvedFundingOrderOptions): Promise<ResolvePendingCheckoutOrderResult | null> {
  if (!pendingOrder?.fundingUnresolved || pendingOrder.merchantId !== merchantId) {
    return null;
  }

  let existingOrder: Awaited<ReturnType<typeof fetchFencedOrderState>> = null;
  if (pendingOrder.trackingToken && pendingOrder.orderId) {
    existingOrder = await fetchFencedOrderState({
      fetchImpl,
      merchantSlug,
      pendingOrder,
    });
    if (existingOrder && isPaidOrderState(existingOrder)) {
      return {
        reusableOrder: null,
        clearStoredOrder: true,
        paidOrder: paidOrderIdentity(pendingOrder, existingOrder),
      };
    }
  }

  const canRetryStoreCredit =
    pendingOrder.fundingRetryable === true &&
    pendingOrder.paymentMethod !== 'oxygen' &&
    Boolean(pendingOrder.trackingToken) &&
    normalizeText(pendingOrder.customerEmail) ===
      normalizeText(customerEmail) &&
    checkoutFingerprintsMatch(
      pendingOrder.checkoutFingerprint,
      checkoutFingerprint,
      pendingOrder.walletAmountUsed
    ) &&
    existingOrder != null &&
    !isNonReusableOrderState(existingOrder);

  if (canRetryStoreCredit) {
    const mutationFetch = fetchImpl === fetch ? fetchWithCsrf : fetchImpl;
    const retryResponse = await mutationFetch('/api/orders/reuse', {
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
        retry_store_credit: true,
      }),
    });
    if (retryResponse.ok) {
      const retried = (await retryResponse.json()) as {
        order?: ReusedCheckoutOrder;
        amountDueToGateway?: number;
      };
      if (retried.order?.id) {
        return {
          reusableOrder: {
            order: retried.order,
            amountDueToGateway:
              typeof retried.amountDueToGateway === 'number'
                ? retried.amountDueToGateway
                : (pendingOrder.amountDueToGateway ??
                  Number(existingOrder?.total || 0)),
          },
          clearStoredOrder: false,
        };
      }
    } else {
      const retryFailure = await Promise.resolve()
        .then(() => retryResponse.json())
        .catch(() => null);
      if (retryFailure?.code === 'STORE_CREDIT_RETRY_REQUIRED') {
        throw new Error(
          'Store credit is temporarily busy. Retry the same order shortly.'
        );
      }
    }
  }

  throw new Error(
    pendingOrder.paymentMethod === 'oxygen'
      ? oxygenPreviousPaymentUnresolved
      : unresolvedFundingOrderMessage
  );
}
