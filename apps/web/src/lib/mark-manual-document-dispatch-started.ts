import type { SupabaseClient } from '@supabase/supabase-js';

interface DispatchOrderSnapshot {
  customer_id: string | null;
  customer_email: string | null;
  total: number;
  amount_paid: number;
  payment_status: string;
  shipping_status: string;
  order_items: readonly unknown[];
}

interface DispatchOutboxRow {
  id: string;
  order_id: string;
  merchant_id: string;
  claim_owner: string;
}

/**
 * Atomically validates the rendered snapshot and marks dispatch start. A
 * check-then-mark in application code leaves a millisecond race between the
 * re-read and the marker; the RPC holds the order row while comparing, so a
 * payment, contact correction, or item edit landing mid-dispatch aborts
 * instead of sending a stale document. Callers must pass the exact values
 * the PDF was rendered from.
 */
export async function markManualDocumentDispatchStarted(
  supabase: SupabaseClient,
  row: DispatchOutboxRow,
  order: DispatchOrderSnapshot
): Promise<void> {
  const { data, error } = await supabase.rpc(
    'mark_manual_document_dispatch_started',
    {
      p_outbox_id: row.id,
      p_claim_owner: row.claim_owner,
      p_customer_id: order.customer_id,
      p_customer_email: order.customer_email,
      p_total: order.total,
      p_amount_paid: order.amount_paid,
      p_payment_status: order.payment_status,
      p_shipping_status: order.shipping_status,
      p_item_count: order.order_items.length,
    }
  );
  if (error) throw new Error('Manual document dispatch state unavailable');
  if (data?.status === 'stale')
    throw new Error('Manual document order changed before dispatch');
  if (data?.status !== 'marked')
    throw new Error('Manual document dispatch lease lost');
}
