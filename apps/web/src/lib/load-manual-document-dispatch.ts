import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { manualDocumentMerchantSchema } from '@/schemas/manual-order-document-merchant';
import { manualDocumentOrderSchema } from '@/schemas/manual-order-document-order';
import { resolveOrderNotificationRecipient } from './order-notification-recipient';

export type ManualDocumentSnapshot = {
  order: unknown;
  merchant: unknown;
  tax_subtotals: unknown[];
  transactions: unknown[];
  payment_accounts: unknown[];
  claim_domain: string | null;
};

export type ManualDocumentDispatchRow = {
  id: string;
  merchant_id: string;
  claim_owner: string;
  event_type: 'manual_order_invoice' | 'manual_order_receipt';
};

export type LoadedManualDocumentDispatch =
  | {
      status: 'ready';
      order: z.infer<typeof manualDocumentOrderSchema>;
      merchant: z.infer<typeof manualDocumentMerchantSchema>;
      snapshot: ManualDocumentSnapshot;
      recipient: { ok: true; email: string };
      paymentStatus: string;
    }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

// Loads the claim-bound dispatch snapshot and validates the dispatch
// inputs: tenant match, manual provenance, recipient, customer, and items.
// Deterministic shape failures skip (later triggers re-arm) instead of
// throwing into max_attempts retries; only transient fetch/RPC failures
// keep throw/retry.
export async function loadManualDocumentDispatch(input: {
  supabase: SupabaseClient;
  row: ManualDocumentDispatchRow;
}): Promise<LoadedManualDocumentDispatch> {
  const { supabase, row } = input;
  const { data: snapshotData, error: snapshotError } = await supabase.rpc(
    'get_manual_order_document_snapshot',
    { p_outbox_id: row.id, p_claim_owner: row.claim_owner }
  );
  if (snapshotError) throw new Error('Manual document data unavailable');
  // A re-arm stole the claim between claim and send: fail for a bounded
  // retry (the row is pending again) instead of emailing from a snapshot
  // the worker no longer owns.
  if (!snapshotData)
    return { status: 'failed', error: 'dispatch_claim_superseded' };
  const snapshot = snapshotData as unknown as ManualDocumentSnapshot;
  if (!snapshot.order || !snapshot.merchant)
    return { status: 'skipped', reason: 'order_or_merchant_missing' };
  const orderParsed = manualDocumentOrderSchema.safeParse(snapshot.order);
  if (!orderParsed.success)
    return { status: 'skipped', reason: 'order_validation_failed' };
  const merchantParsed = manualDocumentMerchantSchema.safeParse(
    snapshot.merchant
  );
  if (!merchantParsed.success)
    return { status: 'skipped', reason: 'merchant_validation_failed' };
  const order = orderParsed.data;
  const merchant = merchantParsed.data;
  // No DB constraint on either status column: normalize legacy spellings
  // exactly like the enqueue trigger so both agree on terminal/paid/eligible.
  const paymentStatus = order.payment_status
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (
    order.merchant_id !== row.merchant_id ||
    merchant.id !== row.merchant_id ||
    !order.recorded_by_user_id ||
    order.import_job_id ||
    order.external_source?.trim() ||
    ['cancelled', 'canceled', 'returned', 'failed'].includes(
      order.shipping_status.trim().toLowerCase()
    ) ||
    !['paid', 'unpaid', 'pending', 'partially_paid'].includes(paymentStatus)
  ) {
    return { status: 'skipped', reason: 'ineligible_manual_order' };
  }
  const recipient = resolveOrderNotificationRecipient(order.customer_email);
  if (!recipient.ok) return { status: 'skipped', reason: recipient.reason };
  if (!order.customer_id)
    return { status: 'skipped', reason: 'missing_customer' };
  if (!order.order_items.length)
    return { status: 'skipped', reason: 'missing_order_items' };
  return {
    status: 'ready',
    order,
    merchant,
    snapshot,
    recipient,
    paymentStatus,
  };
}
