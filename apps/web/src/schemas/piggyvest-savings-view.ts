import { z } from 'zod';
import { piggyvestSavingsLedgerStoreSchemas } from './piggyvest-savings-ledger-store';
import { piggyvestSavingsPolicyInputSchema } from './piggyvest-savings-policy';

export const piggyvestSavingsViewSchemas = {
  configuration: z
    .strictObject({
      environment: z.literal('staging'),
      integrationId: z.uuid(),
      merchantId: z.uuid(),
      expectedProjectId: z.string().min(1),
      actualProjectId: z.string().min(1),
      allowlistedCustomerIds: z.array(z.uuid()).min(1).max(100),
    })
    .refine((input) => input.expectedProjectId === input.actualProjectId),
  goal: z.strictObject({
    identity: piggyvestSavingsLedgerStoreSchemas.identity,
    policy: z.strictObject(piggyvestSavingsPolicyInputSchema.shape).omit({
      ledger: true,
      reservation: true,
      fundingReversed: true,
      now: true,
    }),
  }),
};
