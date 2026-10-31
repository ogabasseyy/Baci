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
 * - `not_found`: HTTP 404. In the live sandbox (2026-10-31, proof p2) a
 *   202-accepted transfer answered 404, then pending, then successful, and
 *   an unknown reference answered the same 404 "Transaction Not Found". A
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

/** A TSQ body: a status counts only when bound to our transfer. */
export function classifyTransferReferenceResponse(
  response: unknown,
  expected: TransferReferenceBinding
): TransferReferenceLookup {
  const live = tsq.walletTransferResponse.safeParse(response);
  if (live.success) {
    const record = live.data.data;
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
