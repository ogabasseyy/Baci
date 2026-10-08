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
  const success =
    prefundedCardTransferVerificationSchemas.rich.safeParse(providerResponse);
  const failure = success.success
    ? null
    : prefundedCardTransferVerificationSchemas.richFailed.safeParse(
        providerResponse
      );
  if (!reservation.success || (!success.success && !failure?.success))
    return { status: 'unverified' as const };
  const expected = reservation.data;
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
