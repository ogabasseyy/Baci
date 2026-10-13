import { z } from 'zod';

export const merchantWalletFundingConsentSchema = z.strictObject({
  consent: z.literal(true),
});

export const merchantWalletFundingAccountSchema = z.object({
  accountName: z.string().nullable(),
  accountNumber: z.string().regex(/^\d{10,20}$/),
  bankName: z.string().nullable(),
  currency: z.literal('NGN'),
  status: z.enum(['pending', 'active', 'disabled']),
});

export type MerchantWalletFundingAccount = z.infer<
  typeof merchantWalletFundingAccountSchema
>;
