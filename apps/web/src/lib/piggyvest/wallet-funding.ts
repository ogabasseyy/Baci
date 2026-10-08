import 'server-only';
import z from 'zod';
import { type PiggyvestClientConfig, piggyvestRequest } from './client';

/**
 * PiggyVest wallet funding channels (sandbox-gated, no live calls).
 *
 * Latest-docs patterns applied:
 * - Funding accounts are retrieved per wallet and verified before display;
 *   bank examples in docs are not promises of availability.
 * - Prefer regular accounts for repeated savings deposits; disposable
 *   accounts carry expiry/amount policies for one-shot top-ups.
 * - Test-mode funding is capped at NGN 100,000 per call, enforced here as
 *   well as provider-side. Amounts are integer kobo.
 */

const fundingAccountSchema = z.object({
  account_number: z.string().min(1),
  account_name: z.string().min(1),
  bank_name: z.string().min(1),
  paypoint_name: z.string().nullable(),
  paypoint_id: z.string().nullable(),
});

export type PiggyvestFundingAccount = z.infer<typeof fundingAccountSchema>;

const fundingAccountsDataSchema = z.array(fundingAccountSchema);

export function retrievePiggyvestFundingAccounts(
  config: PiggyvestClientConfig,
  walletId: string
): Promise<PiggyvestFundingAccount[]> {
  const id = z.string().min(1).parse(walletId);
  return piggyvestRequest(
    config,
    fundingAccountsDataSchema,
    `/api/v1/wallet/${encodeURIComponent(id)}/accounts`
  );
}

const reserveRegularInputSchema = z.object({
  walletId: z.string().min(1),
  name: z.string().min(1).max(200),
  bvn: z
    .string()
    .regex(/^\d{11}$/, 'BVN must be exactly 11 digits')
    .optional(),
  bankCode: z.string().min(1).max(10).optional(),
});

const reserveDisposableInputSchema = reserveRegularInputSchema.extend({
  expiryMinutes: z.int().positive(),
  expectedAmountKobo: z.int().nonnegative().optional(),
  reference: z.string().min(1).max(200).optional(),
  paymentPolicy: z
    .enum(['ALLOW_ANY', 'EXACT_ONLY', 'REJECT_UNDER_PAYMENT'])
    .optional(),
  errorMarginKobo: z.int().nonnegative().optional(),
});

const reserveDataSchema = z.object({
  reference: z.string().min(1),
  account_details: z.object({
    account_number: z.string().min(1),
    account_name: z.string().min(1),
    bank_name: z.string().min(1),
  }),
});

export type ReservePiggyvestAccountResult = z.infer<typeof reserveDataSchema>;

export function reservePiggyvestRegularAccount(
  config: PiggyvestClientConfig,
  input: z.input<typeof reserveRegularInputSchema>
): Promise<ReservePiggyvestAccountResult> {
  const parsed = reserveRegularInputSchema.parse(input);
  return piggyvestRequest(
    config,
    reserveDataSchema,
    '/api/v1/wallet/reserve-account',
    {
      body: {
        wallet_id: parsed.walletId,
        type: 'regular',
        name: parsed.name,
        bvn: parsed.bvn,
        code: parsed.bankCode,
      },
    }
  );
}

export function reservePiggyvestDisposableAccount(
  config: PiggyvestClientConfig,
  input: z.input<typeof reserveDisposableInputSchema>
): Promise<ReservePiggyvestAccountResult> {
  const parsed = reserveDisposableInputSchema.parse(input);
  return piggyvestRequest(
    config,
    reserveDataSchema,
    '/api/v1/wallet/reserve-account',
    {
      body: {
        wallet_id: parsed.walletId,
        type: 'disposable',
        name: parsed.name,
        bvn: parsed.bvn,
        code: parsed.bankCode,
        expiry: parsed.expiryMinutes,
        amount: parsed.expectedAmountKobo,
        reference: parsed.reference,
        payment_policy: parsed.paymentPolicy,
        error_margin: parsed.errorMarginKobo,
      },
    }
  );
}

const TEST_MODE_FUNDING_CAP_KOBO = 10_000_000;

export async function fundPiggyvestWalletTestMode(
  config: PiggyvestClientConfig,
  input: { walletId: string; amountKobo: number }
): Promise<void> {
  const parsed = z
    .object({
      walletId: z.string().min(1),
      amountKobo: z.int().positive().max(TEST_MODE_FUNDING_CAP_KOBO),
    })
    .parse(input);
  await piggyvestRequest(config, z.unknown(), '/api/v1/transfer/test/funding', {
    body: { wallet_id: parsed.walletId, amount: parsed.amountKobo },
  });
}
