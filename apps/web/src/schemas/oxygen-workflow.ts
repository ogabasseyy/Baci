import { z } from 'zod';

export const oxygenWorkflowStageSchema = z.enum([
  'application_required',
  'eligibility_required',
  'kyc_required',
  'plan_required',
  'booked',
  'approval_required',
  'payment_required',
  'ready_for_activation',
  'activated',
  'reconciliation_required',
]);
export const oxygenWorkflowCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start_application') }).strict(),
  z.object({ action: z.literal('refresh_eligibility') }).strict(),
  z.object({ action: z.literal('refresh_kyc') }).strict(),
  z
    .object({
      action: z.literal('book'),
      equityPercentage: z.number().int().min(25).max(99),
      tenure: z.number().int().min(1).max(12),
    })
    .strict(),
  z.object({ action: z.literal('cancel_booking') }).strict(),
  z.object({ action: z.literal('refresh_payment_setup') }).strict(),
]);
export const oxygenWorkflowRequestSchema = z
  .object({
    orderId: z.uuid(),
    channel: z.enum(['web', 'mobile', 'chat']),
  })
  .strict();
export const oxygenWorkflowSubmissionSchema = z
  .object({
    workflowId: z.uuid(),
    version: z.number().int().nonnegative(),
    idempotencyKey: z.uuid(),
    command: oxygenWorkflowCommandSchema,
  })
  .strict();
export const oxygenWorkflowSnapshotSchema = z
  .object({
    id: z.uuid(),
    order_id: z.uuid(),
    stage: oxygenWorkflowStageSchema,
    version: z.number().int().nonnegative(),
    environment: z.enum(['staging', 'production']),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();
export type OxygenWorkflowCommand = z.infer<typeof oxygenWorkflowCommandSchema>;
export type OxygenWorkflowStage = z.infer<typeof oxygenWorkflowStageSchema>;
