import 'server-only';
import { piggyvestPrimarySavingsTransferSchemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { piggyvestTransactionStatusSchemas } from '@/schemas/piggyvest-transaction-status';

export function verifyPrimaryWalletSavingsProof(
  storedReservation: unknown,
  providerResponse: unknown
) {
  const reservation =
    piggyvestPrimarySavingsTransferSchemas.reserved.safeParse(
      storedReservation
    );
  if (!reservation.success) return { status: 'unverified' as const };
  const expected = reservation.data;
  // Money moves only on the full TSQ record bound to this reservation
  // (docs/piggyvest-contract-evidence/2026-10-31.md, P2), parsed with the
  // shared TSQ schema: our reference in third_party_reference, the exact
  // amount, a zero fee, the reserved provider customer and business,
  // source = the customer's main wallet, destination = the goal wallet,
  // the provider id echoed as internal_reference, and the observed
  // terminal status ('successful' settles, 'failed' releases). A body
  // matching only reference, amount and status ("success by reference")
  // proves neither direction, fee nor either wallet, so it never settles or
  // releases; like every other mismatch it stays unverified (pending).
  const parsed =
    piggyvestTransactionStatusSchemas.walletTransferResponse.safeParse(
      providerResponse
    );
  if (!parsed.success) return { status: 'unverified' as const };
  const actual = parsed.data.data;
  if (
    (actual.status !== 'successful' && actual.status !== 'failed') ||
    actual.internal_reference !== actual.id ||
    actual.fee !== 0 ||
    expected.sourceWalletId === expected.destinationWalletId ||
    actual.amount !== expected.amountKobo ||
    actual.third_party_reference !== expected.reference ||
    actual.source_wallet !== expected.sourceWalletId ||
    actual.destination_wallet !== expected.destinationWalletId ||
    // The live sandbox (2026-11-04, S12) reports the BUSINESS id in
    // customer_id for an API-key wallet-to-wallet transfer, and sends no
    // business_id; the customer id is still accepted in case live differs.
    // The wallets above already bind the transfer to this customer.
    (actual.customer_id !== expected.providerCustomerId &&
      actual.customer_id !== expected.businessId) ||
    (actual.business_id !== undefined &&
      actual.business_id !== expected.businessId)
  )
    return { status: 'unverified' as const };
  // A failed transfer authenticates against the same bindings, but its
  // proof releases the hold instead of settling: no funds moved.
  if (actual.status === 'failed')
    return {
      status: 'failed' as const,
      providerTransactionId: actual.id,
      operationId: expected.operationId,
      reference: expected.reference,
      amountKobo: expected.amountKobo,
      sourceWalletId: expected.sourceWalletId,
      destinationWalletId: expected.destinationWalletId,
      businessId: expected.businessId,
    };
  return {
    status: 'verified' as const,
    providerTransactionId: actual.id,
    operationId: expected.operationId,
    reference: expected.reference,
    amountKobo: expected.amountKobo,
    sourceWalletId: expected.sourceWalletId,
    destinationWalletId: expected.destinationWalletId,
    businessId: expected.businessId,
  };
}
