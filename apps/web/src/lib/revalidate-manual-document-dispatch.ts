import type { SupabaseClient } from '@supabase/supabase-js';

interface DispatchRow {
  order_id: string;
  merchant_id: string;
  event_type: 'manual_order_receipt' | 'manual_order_invoice';
}

const TERMINAL_SHIPPING_STATUSES = [
  'cancelled',
  'canceled',
  'returned',
  'failed',
];

/**
 * Re-reads the order's dispatch-critical state immediately before transport.
 * The claim transaction released its order lock, so a payment (or cancel)
 * could have landed after the PDF was rendered. Aborting here — before the
 * dispatch marker is set — lets the outbox retry re-read fresh state and
 * skip via document_state_changed while the separately queued row sends the
 * current document.
 */
export async function revalidateManualDocumentDispatchState(
  supabase: SupabaseClient,
  row: DispatchRow
): Promise<void> {
  const { data, error } = await supabase
    .from('orders')
    .select('payment_status, amount_paid, total, shipping_status')
    .eq('id', row.order_id)
    .eq('merchant_id', row.merchant_id)
    .maybeSingle();
  if (error) throw new Error('Manual document dispatch state unavailable');
  const freshIsPaid = data?.payment_status === 'paid';
  const balanceOutstanding =
    freshIsPaid && Number(data?.amount_paid ?? 0) < Number(data?.total ?? 0);
  const terminallyShipped = TERMINAL_SHIPPING_STATUSES.includes(
    data?.shipping_status ?? ''
  );
  if (
    !data ||
    (row.event_type === 'manual_order_receipt') !== freshIsPaid ||
    balanceOutstanding ||
    terminallyShipped
  ) {
    throw new Error('Manual document order changed before dispatch');
  }
}
