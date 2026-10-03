import { z } from 'zod';

export const manualDocumentClaimSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('created'),
    claim_id: z.string().min(1),
    customer_id: z.string().min(1),
    customer_email: z.string().min(1),
    // Snapshot of the live order row the claim RPC validated: the sender
    // compares these against the order it rendered so an edit that lands
    // mid-preparation retries instead of dispatching a stale document.
    order_total: z.coerce.number(),
    order_amount_paid: z.coerce.number(),
    order_item_count: z.coerce.number().int().nonnegative(),
    order_payment_status: z.string(),
  }),
  z.object({ status: z.literal('skipped') }),
]);

export type ManualDocumentCreatedClaim = Extract<
  z.infer<typeof manualDocumentClaimSchema>,
  { status: 'created' }
>;

export interface ManualDocumentClaimOrderSnapshot {
  customer_id: string | null;
  total: number;
  amount_paid: number;
  order_items: readonly unknown[];
  payment_status: string;
}

/**
 * Confirms the claim RPC validated the same order the sender rendered.
 * Recipient drift fails loudly; an order edit that landed between the
 * sender's read and the claim throws so the worker retries with a fresh
 * read instead of dispatching a stale document.
 */
export function assertManualDocumentClaimMatchesOrder(
  prepared: ManualDocumentCreatedClaim,
  order: ManualDocumentClaimOrderSnapshot,
  recipientEmail: string
): void {
  if (
    prepared.customer_id !== order.customer_id ||
    prepared.customer_email.trim().toLowerCase() !== recipientEmail
  ) {
    throw new Error('Manual document recipient changed');
  }
  if (
    prepared.order_total !== order.total ||
    prepared.order_amount_paid !== order.amount_paid ||
    prepared.order_item_count !== order.order_items.length ||
    prepared.order_payment_status !== order.payment_status
  ) {
    throw new Error('Manual document order changed during preparation');
  }
}
