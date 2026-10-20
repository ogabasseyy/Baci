import { z } from 'zod';
import { WalletFundingAccountSchema } from '@/schemas/wallet-funding-account';

export const walletOrderFundingIntentStatusSchema = z.enum([
  'pending',
  'underfunded',
  'funded',
  'processing',
  'completed',
  'expired',
  'cancelled',
  'review_required',
  'failed',
]);

const currencySchema = z
  .string()
  .trim()
  .transform((currency) => currency.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/));

export const walletOrderFundingIntentSchema = z.object({
  currency: currencySchema,
  debitedAmount: z.number().min(0).optional(),
  excessAmount: z.number().min(0).optional(),
  expectedAmount: z.number().gt(0),
  expiresAt: z.iso.datetime({ offset: true }),
  fundedAmount: z.number().min(0),
  id: z.uuid(),
  orderPaid: z.boolean().optional(),
  orderId: z.uuid(),
  remainingAmount: z.number().min(0).optional(),
  status: walletOrderFundingIntentStatusSchema,
  targetOrderAmount: z.number().gt(0),
});

export const walletOrderFundingIntentCreateResponseSchema = z.object({
  account: WalletFundingAccountSchema,
  intent: walletOrderFundingIntentSchema,
});

export const walletOrderFundingIntentPollResponseSchema = z.object({
  intent: walletOrderFundingIntentSchema,
});
