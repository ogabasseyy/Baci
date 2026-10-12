import { z } from 'zod';
import { piggyvestStagingConfigurationSchema } from './piggyvest-staging-configuration';

const identity = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);
const providerText = z.string().min(1).max(512);

export const piggyvestTransactionReconciliationSchema = {
  configuration: piggyvestStagingConfigurationSchema.extend({
    timeoutMs: z.number().int().positive().max(10_000),
    maxResponseBytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024),
  }),
  binding: z
    .object({
      transactionId: identity,
      walletId: identity,
      customerId: identity,
      businessId: identity,
    })
    .strict(),
  response: z.object({
    status: z.literal(true),
    data: z.object({
      id: identity,
      customer_id: identity,
      source_wallet: z.string().max(512),
      destination_wallet: z.string().max(512),
      status: providerText,
      amount: z.number().finite(),
      fee: z.number().finite(),
      category: providerText,
      reference: providerText,
      break_down: z.object({
        gross_interest_payout: z.number().finite(),
        withholding_tax: z.number().finite(),
        net_interest_payout: z.number().finite(),
      }),
    }),
  }),
};

export type PiggyvestTransactionObservation = z.infer<
  typeof piggyvestTransactionReconciliationSchema.response
>['data'];
