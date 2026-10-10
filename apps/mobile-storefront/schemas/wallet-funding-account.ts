import { z } from 'zod';

const WALLET_FUNDING_PROVIDERS = ['paystack', 'piggyvest'] as const;

const WalletFundingProviderSchema = z.enum(WALLET_FUNDING_PROVIDERS);

// Name caps mirror the server snapshot schema
// (apps/web/src/schemas/piggyvest-primary-wallet-snapshot.ts): the
// server accepts provider names up to 200 chars, so the client must
// parse the same — a tighter client cap would reject a funding
// account the server legitimately returned.
export const WalletFundingAccountSchema = z.object({
  accountName: z.string().trim().min(1).max(200),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{10,20}$/),
  bankName: z.string().trim().min(1).max(200),
  provider: WalletFundingProviderSchema,
});

export const WalletFundingAccountResponseSchema = z.object({
  account: WalletFundingAccountSchema.nullable(),
  requiresConsent: z.boolean(),
});

export type WalletFundingAccount = z.infer<typeof WalletFundingAccountSchema>;
