import 'server-only';
import {
  type ProviderTransferExpectation,
  type ProviderTransferRecord,
  piggyvestTransactionStatusSchemas as schemas,
} from '@/schemas/piggyvest-transaction-status';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import { outflowReferenceCandidates } from './transfer-outbox';
import {
  classifyTransferRecord,
  classifyTransferReferenceFailure,
  type TransferReferenceLookup,
} from './transfer-reference-lookup';

/**
 * The one reader of a PiggyVest wallet transfer by OUR reference. It wraps
 * the shared TSQ rule (transfer-reference-lookup.ts: same outcomes, same
 * reference, amount and wallet binding, a 404 is never absence) and adds
 * what the settlement engine needs to act on a reading:
 *
 * - currency: a record that names a currency must say NGN; the live record
 *   names none (docs/piggyvest-contract-evidence/2026-10-31.md, P2), so NGN
 *   is then bound from the two registered wallets, which must both be NGN;
 * - category: the record's category, when present, must be `p2p`;
 * - direction: from the registered wallets' roles; a record whose wallets
 *   are swapped is a different transfer and never binds;
 * - fee: null or any non-negative amount, with its payer (see feeOf).
 *
 * `submitted`, `pending` and `failed` carry the bound transfer. `not_found`
 * (HTTP 404) and `uncertain` carry nothing that can move money.
 */
export type ProviderTransferRole =
  ProviderTransferExpectation['source']['role'];

export type ProviderTransferFeePayer =
  | 'none'
  | 'source'
  | 'fee_wallet'
  | 'unknown';

export interface ProviderTransferFee {
  kobo: number | null;
  payer: ProviderTransferFeePayer;
  payerWalletId: string | null;
}

export interface BoundProviderTransfer {
  reference: string;
  providerTransactionId: string;
  providerReference: string;
  providerStatus: ProviderTransferRecord['status'];
  amountKobo: number;
  currency: 'NGN';
  currencyBoundBy: 'record' | 'registered_wallets';
  fee: ProviderTransferFee;
  direction: { from: ProviderTransferRole; to: ProviderTransferRole };
  sourceWalletId: string;
  destinationWalletId: string;
  /** As reported; which side it names is not established, so it binds nothing. */
  providerCustomerId: string;
}

export type ProviderTransferUncertainReason =
  | 'expectation_invalid'
  | 'provider_error'
  | 'record_unreadable'
  | 'reference_mismatch'
  | 'amount_mismatch'
  | 'direction_reversed'
  | 'wallet_mismatch'
  | 'currency_mismatch'
  | 'currency_unbound'
  | 'category_mismatch'
  | 'business_mismatch';

export type ProviderTransferReading =
  | {
      outcome: Extract<
        TransferReferenceLookup,
        'submitted' | 'pending' | 'failed'
      >;
      transfer: BoundProviderTransfer;
    }
  | { outcome: 'not_found' }
  | { outcome: 'uncertain'; reason: ProviderTransferUncertainReason };

type Expectation = ReturnType<typeof schemas.providerTransferExpectation.parse>;

function uncertain(
  reason: ProviderTransferUncertainReason
): ProviderTransferReading {
  return { outcome: 'uncertain', reason };
}

function parseExpectation(reference: string, expected: unknown) {
  const parsed = schemas.providerTransferExpectation.safeParse(expected);
  const ours = schemas.providerTransfer.shape.third_party_reference;
  return parsed.success && ours.safeParse(reference).success
    ? parsed.data
    : null;
}

function unboundReason(
  record: ProviderTransferRecord,
  reference: string,
  expected: Expectation
): ProviderTransferUncertainReason {
  if (record.third_party_reference !== reference) return 'reference_mismatch';
  if (record.amount !== expected.amountKobo) return 'amount_mismatch';
  if (
    record.source_wallet === expected.destination.walletId &&
    record.destination_wallet === expected.source.walletId
  )
    return 'direction_reversed';
  return 'wallet_mismatch';
}

/**
 * Who bears the fee. The record names no payer: per PiggyVest's API
 * transaction-fee setting, a fee is debited from the business's designated
 * fee wallet when one is set, otherwise from the source wallet. The caller
 * passes the registered Fee wallet only when that setting points at it.
 * This states the configured payer; a consumer that settles a nonzero fee
 * must still check the source was debited exactly the amount.
 */
function feeOf(fee: number | null, expected: Expectation): ProviderTransferFee {
  if (fee === null)
    return { kobo: null, payer: 'unknown', payerWalletId: null };
  if (fee === 0) return { kobo: 0, payer: 'none', payerWalletId: null };
  if (expected.feeWallet)
    return {
      kobo: fee,
      payer: 'fee_wallet',
      payerWalletId: expected.feeWallet.walletId,
    };
  return {
    kobo: fee,
    payer: 'source',
    payerWalletId: expected.source.walletId,
  };
}

/** A TSQ or GET /transaction/:id body, read against our transfer. */
export function readProviderTransferResponse(
  response: unknown,
  input: { reference: string; expected: unknown }
): ProviderTransferReading {
  const expected = parseExpectation(input.reference, input.expected);
  if (!expected) return uncertain('expectation_invalid');
  const parsed = schemas.providerTransferResponse.safeParse(response);
  if (!parsed.success) return uncertain('record_unreadable');
  const record = parsed.data.data;
  const outcome = classifyTransferRecord(record, {
    reference: input.reference,
    amountKobo: expected.amountKobo,
    sourceWalletId: expected.source.walletId,
    destinationWalletId: expected.destination.walletId,
  });
  if (outcome === 'uncertain')
    return uncertain(unboundReason(record, input.reference, expected));
  if (record.currency !== undefined && record.currency !== 'NGN')
    return uncertain('currency_mismatch');
  // Every registered wallet must be NGN, even when the record names NGN.
  const currencies = [expected.source.currency, expected.destination.currency];
  if (expected.feeWallet) currencies.push(expected.feeWallet.currency);
  if (currencies.some((currency) => currency !== 'NGN'))
    return uncertain('currency_unbound');
  if (record.category !== undefined && record.category !== 'p2p')
    return uncertain('category_mismatch');
  if (
    record.business_id !== undefined &&
    expected.businessId !== undefined &&
    record.business_id !== expected.businessId
  )
    return uncertain('business_mismatch');
  return {
    outcome,
    transfer: {
      reference: input.reference,
      providerTransactionId: record.id,
      providerReference: record.reference,
      providerStatus: record.status,
      amountKobo: record.amount,
      currency: 'NGN',
      currencyBoundBy:
        record.currency === 'NGN' ? 'record' : 'registered_wallets',
      fee: feeOf(record.fee, expected),
      direction: { from: expected.source.role, to: expected.destination.role },
      sourceWalletId: record.source_wallet,
      destinationWalletId: record.destination_wallet,
      providerCustomerId: record.customer_id,
    },
  };
}

/** A failed request: only an HTTP 404 reads as `not_found`. */
export function readProviderTransferFailure(
  error: unknown
): ProviderTransferReading {
  return classifyTransferReferenceFailure(error) === 'not_found'
    ? { outcome: 'not_found' }
    : uncertain('provider_error');
}

/** TSQ (GET /api/v1/transaction/verify) for our reference, then read it. */
export async function readProviderTransfer(input: {
  reference: string;
  expected: ProviderTransferExpectation;
  transport: {
    environment: 'staging' | 'production';
    token: string;
    fetchImplementation: typeof fetch;
  };
}): Promise<ProviderTransferReading> {
  const expected = parseExpectation(input.reference, input.expected);
  if (!expected) return uncertain('expectation_invalid');
  const origin = getPrimaryWalletProviderOrigin(input.transport.environment);
  let response: unknown;
  try {
    response = await requestPrefundedCardProviderJson({
      url: `${origin}/api/v1/transaction/verify?reference=${encodeURIComponent(input.reference)}&wallet_id=${encodeURIComponent(expected.source.walletId)}`,
      token: input.transport.token,
      timeoutMs: 5000,
      maxResponseBytes: 65536,
      fetchImplementation: input.transport.fetchImplementation,
      init: { method: 'GET' },
    });
  } catch (error) {
    return readProviderTransferFailure(error);
  }
  return readProviderTransferResponse(response, input);
}

/**
 * Our reference candidates in a wallet-transfer.outflow.success webhook:
 * the envelope's pvb_third_party_reference first (where PiggyVest returns
 * our reference), then the event-detail ids. Anything that is not a p2p
 * wallet-transfer envelope attributes nothing.
 */
export function readTransferEnvelopeReferences(envelope: unknown): string[] {
  const parsed = schemas.walletTransferEnvelope.safeParse(envelope);
  if (!parsed.success) return [];
  const candidates = [
    parsed.data.pvb_third_party_reference,
    ...outflowReferenceCandidates(parsed.data.eventData),
  ];
  return [
    ...new Set(
      candidates.filter((value): value is string => typeof value === 'string')
    ),
  ];
}
