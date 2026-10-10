import 'server-only';
import { piggyvestPrimarySavingsTransferSchemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { prefundedCardProviderEvidenceSchemas } from '@/schemas/prefunded-card-provider-evidence';
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
  if (!success.success && !failure?.success) {
    // The transaction-verify endpoint answers the minimal TSQ shape
    // ({reference, status: success|pending|failed, amount}) — never the
    // rich single-transaction envelope. Requiring rich bindings here
    // would hold every reconciled contribution in pending forever, so
    // accept a TSQ success/failure bound to the reservation's unique
    // reference and amount. The reference is unguessable
    // (pvb-save-<operation uuid>), the channel is the authenticated
    // provider session, and wallets/customer/business stay bound by the
    // server-side reservation the submit path stored. TSQ exposes no
    // provider transaction id, so the provider-echoed reference serves
    // as the settlement idempotency key: unique per operation, so the
    // database duplicate/conflict handling behaves identically. Rich
    // stays first so a fully-bound response keeps its provider id.
    const tsq =
      prefundedCardProviderEvidenceSchemas.tsq.safeParse(providerResponse);
    if (!tsq.success) return { status: 'unverified' as const };
    const observation = tsq.data.data;
    if (
      observation.reference !== expected.reference ||
      observation.amount !== expected.amountKobo ||
      observation.status === 'pending'
    )
      return { status: 'unverified' as const };
    const bindings = {
      providerTransactionId: expected.reference,
      operationId: expected.operationId,
      reference: expected.reference,
      amountKobo: expected.amountKobo,
      sourceWalletId: expected.sourceWalletId,
      destinationWalletId: expected.destinationWalletId,
      businessId: expected.businessId,
    };
    if (observation.status === 'success')
      return { status: 'verified' as const, ...bindings };
    return { status: 'failed' as const, ...bindings };
  }
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
