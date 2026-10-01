import type { SupabaseClient } from '@supabase/supabase-js';

interface RenderedOrderSnapshot {
  id: string;
  merchant_id: string;
  customer_id: string | null;
  customer_email: string | null;
  total: number;
  amount_paid: number;
  payment_status: string;
  shipping_status: string;
  order_items: readonly unknown[];
}

/**
 * Re-reads the rendered order snapshot immediately before transport. The
 * claim transaction released its order lock, so a payment, contact
 * correction, or item edit could have landed after the PDF was rendered.
 * Aborting here — before the dispatch marker is set — lets the outbox retry
 * re-read fresh state (skipping via document_state_changed when the event no
 * longer matches, or sending a fresh render) while the separately queued row
 * sends the current document.
 */
export async function revalidateManualDocumentDispatchState(
  supabase: SupabaseClient,
  order: RenderedOrderSnapshot
): Promise<void> {
  const { data, error } = await supabase
    .from('orders')
    .select(
      'customer_id, customer_email, total, amount_paid, payment_status, shipping_status, order_items(id)'
    )
    .eq('id', order.id)
    .eq('merchant_id', order.merchant_id)
    .maybeSingle();
  if (error) throw new Error('Manual document dispatch state unavailable');
  const freshItems = Array.isArray(data?.order_items) ? data.order_items : null;
  // Emails compare normalized (trim + lowercase mirrors the recipient
  // resolver), so a case-only correction does not abort a send to the same
  // mailbox.
  if (
    !data ||
    freshItems === null ||
    data.customer_id !== order.customer_id ||
    (data.customer_email ?? '').trim().toLowerCase() !==
      (order.customer_email ?? '').trim().toLowerCase() ||
    Number(data.total) !== Number(order.total) ||
    Number(data.amount_paid) !== Number(order.amount_paid) ||
    data.payment_status !== order.payment_status ||
    data.shipping_status !== order.shipping_status ||
    freshItems.length !== order.order_items.length
  ) {
    throw new Error('Manual document order changed before dispatch');
  }
}
