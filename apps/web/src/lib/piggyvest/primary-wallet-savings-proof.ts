import 'server-only';
import { piggyvestPrimarySavingsTransferSchemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { prefundedCardProviderEvidenceSchemas } from '@/schemas/prefunded-card-provider-evidence';
import { prefundedCardTransferVerificationSchemas } from '@/schemas/prefunded-card-transfer-verification';
import { primaryWalletSavingsIdentitySchemas } from '@/schemas/primary-wallet-savings-identity';

export function verifyPrimaryWalletSavingsProof(
  storedReservation: unknown,
  providerResponse: unknown,
  identityEvidence: unknown,
  trustedEnvironment: unknown
) {
  const reservation =
    piggyvestPrimarySavingsTransferSchemas.reserved.safeParse(
      storedReservation
    );
  if (!reservation.success) return { status: 'unverified' as const };
  if (trustedEnvironment !== 'staging' && trustedEnvironment !== 'production')
    return { status: 'unverified' as const };
  const expected = reservation.data;
  const success =
    prefundedCardTransferVerificationSchemas.rich.safeParse(providerResponse);
  const failure = success.success
    ? null
    : prefundedCardTransferVerificationSchemas.richFailed.safeParse(
        providerResponse
      );
  if (!success.success && !failure?.success) {
    // Preserve the established production TSQ contract. Staging TSQ remains
    // pending because it lacks transaction/wallet identity and documented
    // amount units; only staging's rich response can use direct corroboration.
    if (trustedEnvironment !== 'production')
      return { status: 'unverified' as const };
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
  if (trustedEnvironment === 'staging' && !success.success)
    return { status: 'unverified' as const };
  const identity =
    primaryWalletSavingsIdentitySchemas.evidence.safeParse(identityEvidence);
  const identityWalletMatches =
    identity.success &&
    identity.data.environment === trustedEnvironment &&
    identity.data.wallet.id === expected.sourceWalletId &&
    identity.data.wallet.business_id === expected.businessId &&
    identity.data.wallet.api_customer_id === expected.providerCustomerId;
  const stagingSingleIdentity =
    trustedEnvironment === 'staging' &&
    success.success &&
    identityWalletMatches &&
    identity.success &&
    identity.data.environment === 'staging' &&
    'source_wallet' in identity.data.transaction &&
    identity.data.transaction.id === actual.id &&
    identity.data.transaction.status === 'successful' &&
    identity.data.transaction.customer_id === actual.customer_id &&
    identity.data.transaction.source_wallet === expected.sourceWalletId &&
    identity.data.transaction.destination_wallet ===
      expected.destinationWalletId &&
    identity.data.transaction.amount === actual.amount &&
    identity.data.transaction.fee === 0 &&
    identity.data.transaction.reference === actual.reference &&
    identity.data.transaction.third_party_reference === expected.reference &&
    (identity.data.transaction.internal_reference == null ||
      identity.data.transaction.internal_reference === actual.id);
  const productionListIdentity =
    trustedEnvironment === 'production' &&
    success.success &&
    actual.customer_id === expected.businessId &&
    identityWalletMatches &&
    identity.success &&
    identity.data.environment === 'production' &&
    'wallet_id' in identity.data.transaction &&
    identity.data.transaction.id === actual.id &&
    identity.data.transaction.business_id === expected.businessId &&
    identity.data.transaction.wallet_id === expected.sourceWalletId &&
    identity.data.transaction.api_customer_id === expected.providerCustomerId &&
    identity.data.transaction.amount === -expected.amountKobo &&
    identity.data.transaction.third_party_reference === expected.reference &&
    identity.data.transaction.provider_reference === actual.reference;
  const customerIdentityMismatch =
    trustedEnvironment === 'staging'
      ? actual.customer_id !== expected.businessId &&
        actual.customer_id !== expected.providerCustomerId
      : actual.customer_id !== expected.providerCustomerId &&
        !productionListIdentity;
  if (
    expected.sourceWalletId === expected.destinationWalletId ||
    actual.amount !== expected.amountKobo ||
    actual.third_party_reference !== expected.reference ||
    actual.source_wallet !== expected.sourceWalletId ||
    actual.destination_wallet !== expected.destinationWalletId ||
    customerIdentityMismatch ||
    (trustedEnvironment === 'staging' && !stagingSingleIdentity) ||
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
