import { z } from 'zod';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

function boundedText(maxLength: number) {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine(
      (value) =>
        value.trim().length > 0 &&
        value.isWellFormed() &&
        !Array.from(value).some((character) => {
          const code = character.charCodeAt(0);
          return code <= 31 || code === 127;
        })
    );
}

const fundingAccount = z.object({
  account_number: boundedText(64),
  account_name: boundedText(256),
  bank_name: boundedText(256),
  paypoint_name: boundedText(256).nullable(),
  paypoint_id: piggyvestProviderIdSchema.nullable(),
});

export const piggyvestFundingAccountsSchemas = {
  trustedIdentity: z
    .object({
      environment: z.literal('staging'),
      integrationId: z.uuid(),
      merchantId: z.uuid(),
      customerId: z.uuid(),
      goalId: z.uuid(),
      providerWalletId: piggyvestProviderIdSchema,
      providerCustomerId: piggyvestProviderIdSchema,
    })
    .strict(),
  response: z.object({
    status: z.literal(true),
    data: z.array(fundingAccount).max(32),
  }),
};

export type PiggyvestFundingAccount = z.infer<typeof fundingAccount>;
