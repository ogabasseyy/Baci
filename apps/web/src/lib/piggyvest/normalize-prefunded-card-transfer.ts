import 'server-only';
import { prefundedCardClaimedRequestSchema } from '@/schemas/prefunded-card-claimed-request';
import { prefundedCardTransferVerificationSchemas as schemas } from '@/schemas/prefunded-card-transfer-verification';

export function normalizePrefundedCardTransfer(input: {
  claim: unknown;
  response: unknown;
  corroboration?: unknown;
  expectedSystemIdentifier?: string;
}) {
  const claim = prefundedCardClaimedRequestSchema.parse(input.claim);
  const flat = schemas.normalized.safeParse(input.response);
  if (flat.success) {
    const data = flat.data.data;
    if (
      data.reference !== claim.transferReference ||
      data.amount !== claim.amountKobo ||
      data.currency !== claim.currency ||
      data.business_id !== claim.businessId ||
      data.source_wallet !== claim.sourceWalletId ||
      data.destination_wallet !== claim.destinationWalletId ||
      data.destination_customer_id !== claim.destinationCustomerId
    )
      return { outcome: 'deferred' } as const;
    return {
      outcome: 'verified_success' as const,
      evidence: {
        reference: data.reference,
        amountKobo: data.amount,
        currency: data.currency,
        businessId: data.business_id,
        sourceWalletId: data.source_wallet,
        destinationWalletId: data.destination_wallet,
        destinationCustomerId: data.destination_customer_id,
        providerTransactionId: data.id,
      },
    };
  }
  const rich = schemas.rich.safeParse(input.response);
  const proof = schemas.corroboration.safeParse(input.corroboration);
  if (!rich.success || !proof.success || !input.expectedSystemIdentifier)
    return { outcome: 'deferred' } as const;
  const data = rich.data.data;
  const source = proof.data.sourceWallet.data;
  const destination = proof.data.destinationWallet.data;
  const { binding, crosswalk, observedAt } = proof.data.ownership;
  const now = Date.now();
  const age = now - Date.parse(proof.data.retrievedAt);
  const bindingAge = now - Date.parse(observedAt);
  if (
    age < 0 ||
    age > 60000 ||
    bindingAge < 0 ||
    bindingAge > 60000 ||
    now >= Date.parse(crosswalk.expiresAt) ||
    data.third_party_reference !== claim.transferReference ||
    data.amount !== claim.amountKobo ||
    data.customer_id !== claim.businessId ||
    source.business_id !== claim.businessId ||
    destination.business_id !== source.business_id ||
    source.currency !== claim.currency ||
    destination.currency !== source.currency ||
    source.status !== 'active' ||
    destination.status !== 'active' ||
    source.id !== claim.sourceWalletId ||
    destination.id !== claim.destinationWalletId ||
    data.source_wallet !== source.id ||
    data.destination_wallet !== destination.id ||
    binding.systemIdentifier !== input.expectedSystemIdentifier ||
    binding.integrationId !== claim.integrationId ||
    binding.merchantId !== claim.merchantId ||
    binding.customerId !== claim.customerId ||
    binding.goalId !== claim.goalId ||
    binding.providerWalletId !== destination.id ||
    binding.providerCustomerId !== claim.destinationCustomerId ||
    crosswalk.integrationId !== binding.integrationId ||
    crosswalk.merchantId !== binding.merchantId ||
    crosswalk.customerId !== binding.customerId ||
    crosswalk.businessId !== destination.business_id ||
    crosswalk.publicWalletId !== destination.id ||
    crosswalk.webhookCustomerId !== binding.providerCustomerId ||
    !destination.api_customer_id ||
    destination.api_customer_id !== crosswalk.apiCustomerId ||
    (data.business_id !== undefined &&
      data.business_id !== source.business_id) ||
    (data.currency !== undefined && data.currency !== source.currency) ||
    (data.destination_customer_id !== undefined &&
      data.destination_customer_id !== crosswalk.webhookCustomerId)
  )
    return { outcome: 'deferred' } as const;
  return {
    outcome: 'verified_success' as const,
    evidence: {
      reference: data.third_party_reference,
      amountKobo: data.amount,
      currency: source.currency,
      businessId: source.business_id,
      sourceWalletId: source.id,
      destinationWalletId: destination.id,
      destinationCustomerId: crosswalk.webhookCustomerId,
      providerTransactionId: data.id,
    },
  };
}
