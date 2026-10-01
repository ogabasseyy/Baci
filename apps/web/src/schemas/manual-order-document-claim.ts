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
