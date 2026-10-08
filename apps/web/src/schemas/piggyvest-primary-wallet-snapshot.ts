import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

export const piggyvestPrimaryWalletSnapshotSchemas = {
  mapping: z
    .strictObject({
      providerWalletId: piggyvestProviderIdSchema,
      providerCustomerId: piggyvestProviderIdSchema,
    })
    .nullable(),
  wallet: z.object({
    id: piggyvestProviderIdSchema,
    business_id: piggyvestProviderIdSchema,
    currency: z.literal('NGN'),
    status: z.string(),
    balance: z.int().nonnegative(),
  }),
  accounts: z
    .array(
      z.object({
        account_number: z.string().regex(/^\d{10}$/),
        account_name: z.string().trim().min(1).max(200),
        bank_name: z.string().trim().min(1).max(200),
      })
    )
    .max(20),
};
