import z from 'zod';

/** pg returns bigint as a string; amounts must be whole, non-negative and safe. */
const koboFromBigint = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,15})$/)
  .transform(Number)
  .refine(Number.isSafeInteger);

const timestamp = z
  .union([z.date(), z.iso.datetime({ offset: true })])
  .transform((value) => (value instanceof Date ? value : new Date(value)));

/** One row of piggyvest_approvals.list_open_ops_requests(). */
export const opsOpenRequestRowSchema = z
  .strictObject({
    request_id: z.uuid(),
    action: z.string().regex(/^[a-z][a-z_]{2,62}$/),
    label: z.string().min(1).max(200),
    subject: z.string().min(1).max(200),
    amount_kobo: koboFromBigint,
    amount_naira: z.string().min(1).max(64),
    destination: z.string().min(1).max(200),
    reason: z.string().max(400).nullable(),
    requested_by: z.string().min(1).max(63),
    opened_at: timestamp,
    expires_at: timestamp,
    approvals: z.int().nonnegative(),
    decided_by_you: z.boolean(),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .transform((row) => ({
    requestId: row.request_id,
    action: row.action,
    label: row.label,
    subject: row.subject,
    amountKobo: row.amount_kobo,
    destination: row.destination,
    reason: row.reason,
    requestedBy: row.requested_by,
    openedAt: row.opened_at,
    expiresAt: row.expires_at,
    approvals: row.approvals,
    decidedByYou: row.decided_by_you,
    digest: row.digest,
  }));

export type OpsOpenRequest = z.output<typeof opsOpenRequestRowSchema>;
