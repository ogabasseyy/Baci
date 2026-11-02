import { z } from 'zod';
export const oxygenPaymentRecoveryActionSchema = z.enum([
  'check_status',
  'resend_upfront',
  'resend_repayment',
]);
export const oxygenPaymentRecoveryRequestSchema = z
  .object({
    workflowId: z.uuid(),
    reference: z.uuid(),
    version: z.number().int().nonnegative(),
    idempotencyKey: z.uuid(),
    action: oxygenPaymentRecoveryActionSchema,
  })
  .strict();
export type OxygenPaymentRecoveryRequest = z.infer<
  typeof oxygenPaymentRecoveryRequestSchema
>;
export const oxygenPaymentRecoveryStateSchema = z
  .object({
    reference: z.uuid(),
    paymentComplete: z.boolean().nullable(),
    setupComplete: z.boolean().nullable(),
    paymentUrl: z.string().max(20000).nullable(),
    setupUrl: z.string().max(20000).nullable(),
    checkedAt: z.iso.datetime({ offset: true }).nullable(),
    lastOutcome: z.enum(['succeeded', 'failed', 'indeterminate']).nullable(),
    pending: z.boolean(),
    resendBlocked: z.boolean().default(false),
  })
  .strict();
export type OxygenPaymentRecoveryState = z.infer<
  typeof oxygenPaymentRecoveryStateSchema
>;
