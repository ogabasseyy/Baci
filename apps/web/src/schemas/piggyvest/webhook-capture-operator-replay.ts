import z from 'zod';

/**
 * Wire shapes of the operator replay functions for PiggyVest webhook
 * captures parked as needs_review
 * (supabase/migrations/20261111140000_piggyvest_capture_operator_replay.sql).
 * The database is the authority; these schemas only refuse to act on a
 * response that does not look like it.
 */

export const PIGGYVEST_CAPTURE_OPERATOR_ROLE =
  'piggyvest_webhook_capture_operator';

/** Logins that must never act as an operator: they bypass the audit trail's intent. */
export const PIGGYVEST_CAPTURE_OPERATOR_FORBIDDEN_LOGINS: readonly string[] = [
  'postgres',
  'supabase_admin',
  'service_role',
  'authenticator',
  'anon',
  'authenticated',
];

export const piggyvestReviewCaptureSchema = z.object({
  captureId: z.uuid(),
  eventType: z.string().nullable(),
  providerTransactionId: z.string().nullable(),
  keyVersion: z.string(),
  attempts: z.int().nonnegative(),
  lastError: z.string().nullable(),
  receivedAt: z.string(),
  parkedAt: z.string(),
  operatorReplays: z.int().nonnegative(),
});

export type PiggyvestReviewCapture = z.infer<
  typeof piggyvestReviewCaptureSchema
>;

export const piggyvestReviewCapturesSchema = z.array(
  piggyvestReviewCaptureSchema
);

export const piggyvestCaptureRequeueResultSchema = z.discriminatedUnion(
  'outcome',
  [
    z.object({
      outcome: z.literal('requeued'),
      auditId: z.int().positive(),
      previousAttempts: z.int().nonnegative(),
      previousLastError: z.string().nullable(),
      operatorReplays: z.int().positive(),
    }),
    z.object({ outcome: z.literal('not_found') }),
    z.object({
      outcome: z.literal('not_in_review'),
      processingState: z.enum(['pending', 'claimed', 'processed']),
    }),
    z.object({
      outcome: z.literal('replay_limit_reached'),
      operatorReplays: z.int().positive(),
    }),
  ]
);

export type PiggyvestCaptureRequeueResult = z.infer<
  typeof piggyvestCaptureRequeueResultSchema
>;

/** Same bounds as the database function: a reason a reviewer can act on. */
export const piggyvestCaptureRequeueReasonSchema = z
  .string()
  .trim()
  .min(10, 'reason must be at least 10 characters')
  .max(500, 'reason must be at most 500 characters');

export const piggyvestCaptureOperatorSessionSchema = z.object({
  login_name: z.string(),
  login_safe: z.boolean(),
  operator_member: z.boolean(),
  grants_usable: z.boolean(),
  secure_transport: z.boolean(),
});

export type PiggyvestCaptureOperatorSession = z.infer<
  typeof piggyvestCaptureOperatorSessionSchema
>;
