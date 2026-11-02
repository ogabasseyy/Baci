import 'server-only';
import { piggyvestTransactionStatusSchemas as tsq } from '@/schemas/piggyvest-transaction-status';
import { prefundedCardTransferVerificationSchemas as verification } from '@/schemas/prefunded-card-transfer-verification';
import { PiggyvestApiError } from './client';

/**
 * What a TSQ lookup of OUR deterministic transfer reference shows.
 *
 * - `submitted`: the provider reports the transfer bound to this reference,
 *   amount and both wallets as successful.
 * - `pending`: the provider holds that bound transfer, not yet terminal.
 * - `failed`: the provider reports that bound transfer as failed. Nothing
 *   moved under it, but the SAME reference must never be sent again; a new
 *   attempt would need a new reference, which these flows do not mint.
 * - `not_found`: HTTP 404. In docs/piggyvest-contract-evidence/2026-10-31.md,
 *   P2 (observed: transfer 202, then TSQ http_404 > pending > successful in
 *   9 polls), and an unknown reference answered the same 404 "Transaction
 *   Not Found". A
 *   404 is therefore "not indexed yet" as much as "never sent": it never
 *   resubmits, releases or otherwise moves money.
 * - `uncertain`: anything else (transport failure, other HTTP status,
 *   malformed or unbound body).
 *
 * PiggyVest offers no positive proof that a reference does not exist, so
 * there is deliberately no `absent` outcome.
 */
export type TransferReferenceLookup =
  | 'submitted'
  | 'pending'
  | 'failed'
  | 'not_found'
  | 'uncertain';

export interface TransferReferenceBinding {
  reference: string;
  amountKobo: number;
  sourceWalletId: string;
  destinationWalletId: string;
}

function httpStatusOf(error: unknown): unknown {
  if (error instanceof PiggyvestApiError) return error.status;
  if (error instanceof Error && 'httpStatus' in error) return error.httpStatus;
  return undefined;
}

/** A failed TSQ request: only an HTTP 404 reads as `not_found`. */
export function classifyTransferReferenceFailure(
  error: unknown
): 'not_found' | 'uncertain' {
  return httpStatusOf(error) === 404 ? 'not_found' : 'uncertain';
}

/** The binding fields of a parsed TSQ wallet-transfer record. */
export interface TransferRecordBinding {
  third_party_reference: string;
  amount: number;
  source_wallet: string;
  destination_wallet: string;
  status: 'pending' | 'successful' | 'success' | 'failed';
}

/**
 * A parsed record: its status counts only when our reference, the amount
 * and both wallets bind. The one rule every TSQ reader shares, including
 * provider-transfer-reader.ts.
 */
export function classifyTransferRecord(
  record: TransferRecordBinding,
  expected: TransferReferenceBinding
): Exclude<TransferReferenceLookup, 'not_found'> {
  if (
    record.third_party_reference !== expected.reference ||
    record.amount !== expected.amountKobo ||
    record.source_wallet !== expected.sourceWalletId ||
    record.destination_wallet !== expected.destinationWalletId
  )
    return 'uncertain';
  if (record.status === 'pending') return 'pending';
  if (record.status === 'failed') return 'failed';
  return 'submitted';
}

/** A TSQ body: a status counts only when bound to our transfer. */
export function classifyTransferReferenceResponse(
  response: unknown,
  expected: TransferReferenceBinding
): TransferReferenceLookup {
  const live = tsq.walletTransferResponse.safeParse(response);
  if (live.success) return classifyTransferRecord(live.data.data, expected);
  const normalized = verification.normalized.safeParse(response);
  if (
    normalized.success &&
    normalized.data.data.reference === expected.reference &&
    normalized.data.data.amount === expected.amountKobo &&
    normalized.data.data.source_wallet === expected.sourceWalletId &&
    normalized.data.data.destination_wallet === expected.destinationWalletId
  )
    return 'submitted';
  return 'uncertain';
}
