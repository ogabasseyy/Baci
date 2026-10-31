import 'server-only';
import { piggyvestPrimarySavingsTransferSchemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { prefundedCardTransferVerificationSchemas } from '@/schemas/prefunded-card-transfer-verification';

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
  const success =
    prefundedCardTransferVerificationSchemas.rich.safeParse(providerResponse);
  const failure = success.success
    ? null
    : prefundedCardTransferVerificationSchemas.richFailed.safeParse(
        providerResponse
      );
  // Money moves only on the full TSQ record bound to this reservation
  // (docs/piggyvest-contract-evidence/2026-10-31.md, P2): our reference in
  // third_party_reference, the exact amount, a zero fee, the reserved
  // provider customer, source = the customer's main wallet, destination =
  // the goal wallet, and a terminal status ('successful' settles, 'failed'
  // releases). A body matching only reference, amount and status ("success
  // by reference") proves neither direction, fee nor either wallet, so it
  // never settles or releases; it stays unverified (pending).
  if (!success.success && !failure?.success)
    return { status: 'unverified' as const };
  const actual = (success.success ? success.data : failure?.data)?.data;
  if (!actual) return { status: 'unverified' as const };
  if (
    expected.sourceWalletId === expected.destinationWalletId ||
    actual.amount !== expected.amountKobo ||
    actual.third_party_reference !== expected.reference ||
    actual.source_wallet !== expected.sourceWalletId ||
    actual.destination_wallet !== expected.destinationWalletId ||
    actual.customer_id !== expected.providerCustomerId ||
    (actual.business_id !== undefined &&
      actual.business_id !== expected.businessId) ||
    (actual.currency !== undefined && actual.currency !== 'NGN')
  )
    return { status: 'unverified' as const };
  // A failed transfer authenticates against the same bindings, but its
  // proof releases the hold instead of settling: no funds moved.
  if (!success.success)
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
