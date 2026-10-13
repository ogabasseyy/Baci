import type { SupabaseClient } from '@supabase/supabase-js';
import { loadOrderGiglInternalCreditRetainedAmount } from '@/lib/shipping/load-order-gigl-internal-credit-retained-amount';
import { loadOrderGiglSettledRetainedAmount } from '@/lib/shipping/load-order-gigl-settled-retained-amount';

export type FundedCheckoutGiglAddressLockOrder = {
  payment_status?: string | null;
  selected_quote_id?: string | null;
  shipping_funding_source?: 'customer_checkout' | 'merchant_wallet' | null;
  shipping_platform_retained_amount?: number | string | null;
  shipping_provider?: string | null;
};

function parseRetainedShippingAmount(
  value: number | string | null | undefined
): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed)
    ? Math.max(0, parsed)
    : 0;
}

/**
 * Customer-checkout GIGL address edits lock when settlements or completed
 * internal credits retain shipping — including partially_paid / pending orders
 * that already retained shipping via invoice or completion fallback. Quote-time
 * snapshots alone (quiz vouchers) stay editable. Mirrors
 * private.order_settled_gigl_retained_amount.
 */
export async function isFundedCheckoutGiglAddressLocked(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  order: FundedCheckoutGiglAddressLockOrder
): Promise<boolean> {
  const selectedQuoteId = order.selected_quote_id?.trim() ?? '';
  if (
    order.shipping_provider !== 'GIGL' ||
    order.shipping_funding_source !== 'customer_checkout' ||
    selectedQuoteId === ''
  ) {
    return false;
  }

  const requiredRetained = parseRetainedShippingAmount(
    order.shipping_platform_retained_amount
  );
  const fromSettlements = await loadOrderGiglSettledRetainedAmount(
    supabase,
    merchantId,
    orderId
  );
  // Skip the internal-credit RPC when settlements alone already prove the lock
  // (any positive retention with no tariff cap, or full cover of a positive
  // retained amount). Avoids failing closed on clients that only mock `.from`.
  const settlementsAlreadyLock =
    fromSettlements > 0 &&
    (requiredRetained <= 0 || fromSettlements >= requiredRetained);
  const fromInternalCredit = settlementsAlreadyLock
    ? 0
    : await loadOrderGiglInternalCreditRetainedAmount(
        supabase,
        merchantId,
        orderId,
        {
          shipping_funding_source: order.shipping_funding_source,
          shipping_platform_retained_amount:
            order.shipping_platform_retained_amount,
        }
      );
  const settledRetained =
    requiredRetained > 0
      ? Math.min(requiredRetained, fromSettlements + fromInternalCredit)
      : fromSettlements + fromInternalCredit;

  return settledRetained > 0;
}
