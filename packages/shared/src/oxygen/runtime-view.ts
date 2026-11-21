import { z } from 'zod';
import { oxygenPlanQuoteSchema } from './plan';
import { oxygenCustomerProviderStateSchema } from './runtime';
import { oxygenWorkflowStageSchema } from './workflow';
export const oxygenRuntimeSnapshotSchema = z
  .object({
    workflowId: z.uuid(),
    stage: oxygenWorkflowStageSchema,
    version: z.number().int().nonnegative(),
    environment: z.enum(['staging', 'production']),
    executionEnabled: z.boolean(),
    ninAttemptStatus: z
      .enum(['first_attempt', 'safe_retry', 'blocked', 'unavailable'])
      .optional(),
    bookingBlock: z.literal('active_loan').nullable().optional(),
    state: oxygenCustomerProviderStateSchema,
    approvalOtpReady: z.boolean(),
    checkoutPhone: z.string().default(''),
    checkoutAddress: z.record(z.string(), z.string()).default({}),
    pending: z
      .object({
        action: z.string(),
        status: z.enum(['queued', 'executing', 'indeterminate']),
        idempotencyKey: z.uuid(),
        bookingTerms: oxygenPlanQuoteSchema
          .pick({ equityPercentage: true, tenure: true })
          .optional(),
      })
      .nullable()
      .optional(),
    activationEnabled: z.literal(false),
    settlementEnabled: z.literal(false),
  })
  .strict();
export type OxygenRuntimeSnapshot = z.infer<typeof oxygenRuntimeSnapshotSchema>;
