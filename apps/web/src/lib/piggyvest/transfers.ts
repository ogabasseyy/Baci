import 'server-only';
import z from 'zod';
import { type PiggyvestClientConfig, piggyvestRequest } from './client';

/**
 * PiggyVest outbound transfers (sandbox-gated, no live calls).
 *
 * Latest-docs patterns applied:
 * - Both money-movement endpoints return 202 "processing" — never success.
 *   Final state arrives via `bank-transfer.outflow.success`,
 *   `bank-transfer.outflow.failed`, or `wallet-transfer.outflow.success`
 *   webhooks, or via TSQ on our own reference. Callers must treat the
 *   accepted response as "submitted", not "settled".
 * - Our `reference` is the idempotency key: reuse it for TSQ and webhook
 *   correlation, never mint a second reference for the same payout.
 * - Resolve the recipient with name enquiry (bank_code + account_number)
 *   before submitting a bank transfer, and confirm the returned
 *   `account_name` with the user.
 * - `bankCode` values come from the bank-list endpoint, never hardcoded.
 * - Amounts cross the boundary as positive integer kobo; currency is NGN.
 */

const koboOutflowSchema = z.int().positive();

const referenceSchema = z.string().min(1).max(200);

const nubanSchema = z
  .string()
  .regex(/^\d{10}$/, 'Account number must be a 10-digit NUBAN');

const narrationSchema = z.string().max(200).optional();

const walletTransferInputSchema = z.object({
  amountKobo: koboOutflowSchema,
  sourceWalletId: z.string().min(1),
  destinationWalletId: z.string().min(1),
  reference: referenceSchema,
  narration: narrationSchema,
});

export type TransferToWalletInput = z.input<typeof walletTransferInputSchema>;

const bankTransferInputSchema = z.object({
  amountKobo: koboOutflowSchema,
  sourceWalletId: z.string().min(1),
  accountNumber: nubanSchema,
  bankCode: z.string().min(1),
  reference: referenceSchema,
  narration: narrationSchema,
});

export type TransferToBankInput = z.input<typeof bankTransferInputSchema>;

const nameEnquiryInputSchema = z.object({
  bankCode: z.string().min(1),
  accountNumber: nubanSchema,
});

export type ResolveAccountNameInput = z.input<typeof nameEnquiryInputSchema>;

const transactionStatusQuerySchema = z.object({
  reference: referenceSchema,
  walletId: z.string().min(1).optional(),
});

export type QueryTransactionStatusInput = z.input<
  typeof transactionStatusQuerySchema
>;

// 202 processing responses carry only `{ status, message }`; the envelope
// check in piggyvestRequest is the contract, `data` is irrelevant.
const processingDataSchema = z.unknown();

export interface TransferAcceptedResult {
  accepted: true;
}

const accountNameDataSchema = z.object({
  account_name: z.string().min(1),
});

export type ResolveAccountNameResult = z.infer<typeof accountNameDataSchema>;

const bankListDataSchema = z.array(
  z.object({
    name: z.string().min(1),
    code: z.string().min(1),
  })
);

export type PiggyvestBank = z.infer<typeof bankListDataSchema>[number];

const transactionStatusDataSchema = z.object({
  reference: z.string().min(1),
  status: z.enum(['success', 'pending', 'failed']),
  amount: z.int().nonnegative(),
  recipient: z.string(),
  bank: z.string(),
  created_at: z.iso.datetime({ offset: true }),
});

export type QueryTransactionStatusResult = z.infer<
  typeof transactionStatusDataSchema
>;

export async function transferToWallet(
  config: PiggyvestClientConfig,
  input: TransferToWalletInput
): Promise<TransferAcceptedResult> {
  const parsed = walletTransferInputSchema.parse(input);
  await piggyvestRequest(
    config,
    processingDataSchema,
    '/api/v1/transfer/wallet',
    {
      body: {
        amount: parsed.amountKobo,
        source: parsed.sourceWalletId,
        destination: parsed.destinationWalletId,
        currency: 'NGN',
        reference: parsed.reference,
        narration: parsed.narration,
      },
    }
  );
  return { accepted: true };
}

export async function transferToBank(
  config: PiggyvestClientConfig,
  input: TransferToBankInput
): Promise<TransferAcceptedResult> {
  const parsed = bankTransferInputSchema.parse(input);
  await piggyvestRequest(
    config,
    processingDataSchema,
    '/api/v1/transfer/bank',
    {
      body: {
        amount: parsed.amountKobo,
        source: parsed.sourceWalletId,
        currency: 'NGN',
        reference: parsed.reference,
        accountNumber: parsed.accountNumber,
        bankCode: parsed.bankCode,
        narration: parsed.narration,
      },
    }
  );
  return { accepted: true };
}

export function resolveAccountName(
  config: PiggyvestClientConfig,
  input: ResolveAccountNameInput
): Promise<ResolveAccountNameResult> {
  const parsed = nameEnquiryInputSchema.parse(input);
  return piggyvestRequest(
    config,
    accountNameDataSchema,
    '/api/v1/transfer/name-enquiry',
    {
      query: {
        bank_code: parsed.bankCode,
        account_number: parsed.accountNumber,
      },
    }
  );
}

export function listBanks(
  config: PiggyvestClientConfig
): Promise<PiggyvestBank[]> {
  return piggyvestRequest(
    config,
    bankListDataSchema,
    '/api/v1/transfer/bank-list'
  );
}

export function queryTransactionStatus(
  config: PiggyvestClientConfig,
  input: QueryTransactionStatusInput
): Promise<QueryTransactionStatusResult> {
  const parsed = transactionStatusQuerySchema.parse(input);
  return piggyvestRequest(
    config,
    transactionStatusDataSchema,
    '/api/v1/transaction/verify',
    {
      query: {
        reference: parsed.reference,
        wallet_id: parsed.walletId,
      },
    }
  );
}
