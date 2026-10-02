import type { SupabaseClient } from '@supabase/supabase-js';

interface DispatchOrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  variant_name: string | null;
  condition: string | null;
  item_description: string | null;
}

interface DispatchOrderSnapshot {
  customer_id: string | null;
  customer_email: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  recorded_by_user_id: string | null;
  import_job_id: string | null;
  external_source: string | null;
  total: number;
  subtotal: number;
  shipping_fee: number;
  tax_amount: number;
  discount_amount: number;
  amount_paid: number;
  currency?: string | null;
  order_number: string;
  payment_status: string;
  payment_method: string | null;
  shipping_status: string;
  invoice_type_code: string | null;
  invoice_note?: string | null;
  notes?: string | null;
  transaction_date: string | null;
  invoice_issue_date: string | null;
  shipping_address: Record<string, unknown> | null;
  order_items: readonly DispatchOrderItem[];
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
 * instead of sending a stale document. The snapshot covers every order-row
 * input the renderer reads (identity, money breakdown, notes, address,
 * dates, and item contents) plus the manual-order origin fields, not just
 * the count: a same-total money redistribution, address correction, or
 * eligibility change must abort too. The rendered kind is passed
 * explicitly so the RPC can snapshot exactly what is being sent. Callers
 * must pass the exact values the PDF was rendered from.
 */
export async function markManualDocumentDispatchStarted(
  supabase: SupabaseClient,
  row: DispatchOutboxRow,
  order: DispatchOrderSnapshot,
  documentKind: 'invoice' | 'proforma_invoice' | 'receipt'
): Promise<void> {
  const { data, error } = await supabase.rpc(
    'mark_manual_document_dispatch_started',
    {
      p_outbox_id: row.id,
      p_claim_owner: row.claim_owner,
      p_customer_id: order.customer_id,
      p_customer_email: order.customer_email,
      p_customer_name: order.customer_name,
      p_customer_phone: order.customer_phone,
      p_recorded_by_user_id: order.recorded_by_user_id,
      p_import_job_id: order.import_job_id,
      p_external_source: order.external_source,
      p_document_kind: documentKind,
      p_total: order.total,
      p_subtotal: order.subtotal,
      p_shipping_fee: order.shipping_fee,
      p_tax_amount: order.tax_amount,
      p_discount_amount: order.discount_amount,
      p_amount_paid: order.amount_paid,
      p_currency: order.currency ?? null,
      p_order_number: order.order_number,
      p_payment_status: order.payment_status,
      p_payment_method: order.payment_method,
      p_shipping_status: order.shipping_status,
      p_invoice_type_code: order.invoice_type_code,
      p_invoice_note: order.invoice_note ?? null,
      p_notes: order.notes ?? null,
      p_transaction_date: order.transaction_date,
      p_invoice_issue_date: order.invoice_issue_date,
      p_shipping_address: order.shipping_address,
      p_item_count: order.order_items.length,
      p_items: [...order.order_items]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((item) => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          variant_name: item.variant_name,
          condition: item.condition,
          item_description: item.item_description,
        })),
    }
  );
  if (error) throw new Error('Manual document dispatch state unavailable');
  if (data?.status === 'stale')
    throw new Error('Manual document order changed before dispatch');
  if (data?.status !== 'marked')
    throw new Error('Manual document dispatch lease lost');
}
