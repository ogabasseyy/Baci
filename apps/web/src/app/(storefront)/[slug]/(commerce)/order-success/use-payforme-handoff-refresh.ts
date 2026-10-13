'use client';

import { useEffect } from 'react';
import {
  fetchStorefrontOrderData,
  type StorefrontOrderData,
} from './fetch-storefront-order';

// The immediate-order after() can provision the Pay for Me DVA after the
// creation response (pre-response Paystack timeout → retry in after()).
// The success page's single lookup may therefore cache an order without
// virtual_account while the payer handoff shows bank-less instructions.
// While the handoff is unpaid and account-less, refetch on a short
// bounded lane so the retry-provisioned details appear without a manual
// refresh. Stops on account arrival, payment/refund, or budget
// exhaustion — never polling forever.
const PAYFORME_HANDOFF_REFRESH_INTERVAL_MS = 5000;
const PAYFORME_HANDOFF_REFRESH_MAX_ATTEMPTS = 12;

export function usePayformeHandoffRefresh({
  lookupEmail,
  merchantSlug,
  onOrder,
  orderId,
  orderToken,
  shouldRefresh,
}: {
  lookupEmail: string | null;
  merchantSlug: string | undefined;
  onOrder: (order: StorefrontOrderData) => void;
  orderId: string | null;
  orderToken: string | null;
  shouldRefresh: boolean;
}): void {
  useEffect(() => {
    if (!shouldRefresh || !orderId) {
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (cancelled) {
        return;
      }
      attempts += 1;
      const data = await fetchStorefrontOrderData(
        orderId,
        merchantSlug,
        orderToken,
        lookupEmail
      ).catch(() => null);
      if (cancelled) {
        return;
      }
      if (data) {
        onOrder(data);
        // The retry landed (or the order moved past payable): stop.
        if (
          data.virtual_account?.account_number ||
          data.payment_status === 'paid' ||
          data.payment_status === 'refunded'
        ) {
          return;
        }
      }
      if (attempts < PAYFORME_HANDOFF_REFRESH_MAX_ATTEMPTS) {
        timer = setTimeout(
          () => void poll(),
          PAYFORME_HANDOFF_REFRESH_INTERVAL_MS
        );
      }
    };
    timer = setTimeout(() => void poll(), PAYFORME_HANDOFF_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [lookupEmail, merchantSlug, onOrder, orderId, orderToken, shouldRefresh]);
}
