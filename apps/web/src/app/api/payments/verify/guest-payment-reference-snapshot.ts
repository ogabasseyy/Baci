import { createAnonClient } from '@/lib/supabase/anon';

/**
 * Proof-bound guest read model: the reference's transaction plus its
 * order, returned only when the reference belongs to an order carrying
 * the supplied tracking token (enforced inside the
 * `get_guest_payment_reference_snapshot` RPC — zero rows otherwise, so
 * a valid reference is indistinguishable from a bogus one).
 */
export interface GuestPaymentReferenceSnapshot {
  transactionId: string;
  orderId: string;
  merchantId: string;
  amount: number;
  currency: string | null;
  transactionStatus: string;
  gateway: string;
  gatewayReference: string;
  orderNumber: string | null;
  orderPaymentStatus: string | null;
  orderShippingStatus: string | null;
  orderTotal: number | null;
  /**
   * True only when every serialized_strict order item is durably held
   * in at least its ordered quantity (see the snapshot RPC;
   * unlimited-fallback and off-policy items are unconstrained). Paid row
   * alone is not success: the finalizer flips payment_status before the
   * inventory-confirm step converges.
   */
  inventoryConfirmed: boolean;
}

function toFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Shared row parser for the guest and sessionless (Bearer-owned)
 * snapshot RPCs, which return the identical verification read model.
 */
export function parsePaymentReferenceSnapshotRow(
  row: Record<string, unknown>
): GuestPaymentReferenceSnapshot | null {
  if (
    typeof row.transaction_id !== 'string' ||
    typeof row.order_id !== 'string' ||
    typeof row.merchant_id !== 'string' ||
    typeof row.gateway_reference !== 'string'
  ) {
    return null;
  }
  const amount = toFiniteNumber(row.amount);
  if (amount === null) {
    return null;
  }
  return {
    transactionId: row.transaction_id,
    orderId: row.order_id,
    merchantId: row.merchant_id,
    amount,
    currency: typeof row.currency === 'string' ? row.currency : null,
    transactionStatus:
      typeof row.transaction_status === 'string' ? row.transaction_status : '',
    gateway: typeof row.gateway === 'string' ? row.gateway : '',
    gatewayReference: row.gateway_reference,
    orderNumber: typeof row.order_number === 'string' ? row.order_number : null,
    orderPaymentStatus:
      typeof row.order_payment_status === 'string'
        ? row.order_payment_status
        : null,
    orderShippingStatus:
      typeof row.order_shipping_status === 'string'
        ? row.order_shipping_status
        : null,
    orderTotal: toFiniteNumber(row.order_total),
    // Fail closed when the column is absent (pre-migration row shape):
    // a paid order without the proof stays pending.
    inventoryConfirmed: row.inventory_confirmed === true,
  };
}

export async function getGuestPaymentReferenceSnapshot(
  reference: string,
  trackingToken: string
): Promise<GuestPaymentReferenceSnapshot | null> {
  try {
    const supabase = createAnonClient();
    const { data, error } = await supabase.rpc(
      'get_guest_payment_reference_snapshot',
      {
        p_gateway_reference: reference,
        p_tracking_token: trackingToken,
      }
    );
    if (error) {
      return null;
    }
    const row = Array.isArray(data) ? data[0] : null;
    if (!row || typeof row !== 'object') {
      return null;
    }
    return parsePaymentReferenceSnapshotRow(row as Record<string, unknown>);
  } catch {
    return null;
  }
}
