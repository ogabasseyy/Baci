import z from 'zod';
import { piggyvestStagingConfigurationSchema } from '../../../src/schemas/piggyvest-staging-configuration';

const outflowScopeSchema = z.object({
  providerCustomerId: z.string().min(1),
  businessId: z.string().min(1),
  integrationId: z.string().min(1),
});

const outflowIdentitySchema = z.object({
  reference: z.string().min(1).max(200),
  amountKobo: z.int().positive(),
  currency: z.literal('NGN'),
  sourceWalletId: z.string().min(1),
  destinationWalletId: z.string().min(1),
  direction: z.enum(['bank', 'wallet']),
});

export const expectedOutflowOperationSchema = outflowIdentitySchema
  .extend(outflowScopeSchema.shape)
  .extend({ status: z.enum(['submitted', 'succeeded', 'failed']) });

export const terminalEvidenceSchema = outflowIdentitySchema
  .extend(outflowScopeSchema.shape)
  .extend({ providerTransactionId: z.string().min(1).max(200) });

export const terminalStatusSchema = z.enum(['succeeded', 'failed']);

export const terminalReconciliationInputSchema = z.object({
  expected: expectedOutflowOperationSchema,
  evidence: terminalEvidenceSchema,
  terminalStatus: terminalStatusSchema,
});

export const transactionStatusResultSchema = z.object({
  reference: z.string().min(1),
  status: z.enum(['success', 'pending', 'failed']),
  amount: z.int().nonnegative(),
  recipient: z.string(),
  bank: z.string(),
  created_at: z.iso.datetime({ offset: true }),
});

export const scopedExpectedOutflowOperationSchema =
  expectedOutflowOperationSchema.extend({ customerId: z.uuid() });

export const transactionStatusNormalizedTerminalSchema =
  transactionStatusResultSchema.extend({
    customerId: z.uuid(),
    currency: z.literal('NGN'),
    sourceWalletId: z.string().min(1),
    destinationWalletId: z.string().min(1),
    direction: z.enum(['bank', 'wallet']),
    providerCustomerId: z.string().min(1),
    businessId: z.string().min(1),
    integrationId: z.string().min(1),
    providerTransactionId: z.string().min(1).max(200),
  });

export const transactionStatusRunnerConfigSchema = z
  .object({
    expectedSystemId: z.string().regex(/^\d{1,20}$/),
    businessId: z.string().min(1),
    integrationId: z.string().min(1),
    stagingConfig: piggyvestStagingConfigurationSchema,
  })
  .strict();

export const replayOutflowTerminalEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.enum([
    'bank-transfer.outflow.success',
    'bank-transfer.outflow.failed',
    'wallet-transfer.outflow.success',
  ]),
  eventCategory: z.string().min(1),
  customer_id: z.string().min(1),
  eventData: z.looseObject({}),
});

export type ExpectedOutflowOperation = z.infer<
  typeof expectedOutflowOperationSchema
>;

export type ScopedExpectedOutflowOperation = z.infer<
  typeof scopedExpectedOutflowOperationSchema
>;

export type TerminalEvidence = z.infer<typeof terminalEvidenceSchema>;

export type TerminalStatus = z.infer<typeof terminalStatusSchema>;

export type ReplayOutflowTerminalEvent = z.infer<
  typeof replayOutflowTerminalEventSchema
>;
