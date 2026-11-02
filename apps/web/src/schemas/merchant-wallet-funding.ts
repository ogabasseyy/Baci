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

/** Rows from public.get_merchant_wallet_funding_account (safe columns only). */
export const merchantWalletFundingAccountRowsSchema = z.array(
  z.object({
    account_name: z.string().nullable(),
    account_number: z.string(),
    bank_name: z.string().nullable(),
    currency: z.literal('NGN'),
    status: z.enum(['active', 'pending']),
  })
);

/**
 * Scalar from public.get_merchant_shipping_wallet_balance. PostgREST returns
 * numeric as a JSON number; a string form is accepted defensively, and a
 * missing value reads as zero like a missing wallet row.
 */
export const merchantShippingWalletBalanceSchema = z
  .union([z.number(), z.string().trim().min(1), z.null()])
  .transform((value) => (value === null ? 0 : Number(value)))
  .pipe(z.number().refine(Number.isFinite));
