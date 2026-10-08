import { z } from 'zod';

const WALLET_FUNDING_PROVIDERS = ['paystack', 'piggyvest'] as const;

const WalletFundingProviderSchema = z.enum(WALLET_FUNDING_PROVIDERS);

export const WalletFundingAccountSchema = z.object({
  accountName: z.string().trim().min(1).max(100),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{10,20}$/),
  bankName: z.string().trim().min(1).max(100),
  provider: WalletFundingProviderSchema,
});

export const WalletFundingAccountResponseSchema = z.object({
  account: WalletFundingAccountSchema.nullable(),
  requiresConsent: z.boolean(),
});

export type WalletFundingAccount = z.infer<typeof WalletFundingAccountSchema>;
