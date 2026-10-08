import 'server-only';
import { piggyvestStagingWalletResponseSchema } from '@/schemas/piggyvest-staging-wallet';
import { prefundedCardProviderEvidenceSchemas as provider } from '@/schemas/prefunded-card-provider-evidence';
import { primaryWalletCardCustodySchemas as schemas } from '@/schemas/primary-wallet-card-custody';

export function verifyPrimaryCardCustodyProof(input: {
  context: unknown;
  envelope: unknown;
  single: unknown;
  verification: unknown;
  sourceWallet: unknown;
  destinationWallet: unknown;
  crosswalk: unknown;
  bodyDigest: string;
  now?: number;
}) {
  try {
    const context = schemas.context.parse(input.context);
    const event = provider.envelope.parse(input.envelope);
    const single = provider.single.parse(input.single).data;
    const verification = provider.tsq.parse(input.verification).data;
    const source = piggyvestStagingWalletResponseSchema.parse(
      input.sourceWallet
    ).data;
    const destination = piggyvestStagingWalletResponseSchema.parse(
      input.destinationWallet
    ).data;
    const crosswalk = schemas.crosswalk.parse(input.crosswalk);
    const now = input.now ?? Date.now();
    const aliases = [...new Set(crosswalk.transactionAliases)].sort();
    if (
      !Number.isFinite(now) ||
      now - Date.parse(crosswalk.observedAt) < 0 ||
      now - Date.parse(crosswalk.observedAt) > 60000 ||
      now >= Date.parse(crosswalk.expiresAt) ||
      aliases.length !== crosswalk.transactionAliases.length ||
      !aliases.includes(single.id) ||
      !aliases.includes(crosswalk.bankInflowTransactionId) ||
      crosswalk.canonicalTransactionId !== single.id ||
      crosswalk.integrationId !== context.integrationId ||
      crosswalk.merchantId !== context.merchantId ||
      crosswalk.customerId !== context.customerId ||
      crosswalk.businessId !== context.businessId ||
      crosswalk.publicWalletId !== context.destinationWalletId ||
      crosswalk.webhookCustomerId !== context.destinationCustomerId ||
      destination.api_customer_id !== crosswalk.apiCustomerId ||
      event.eventType !== 'wallet-transfer.outflow.success' ||
      event.eventCategory !== 'wallet-transfer' ||
      event.customer_id !== crosswalk.treasuryWebhookCustomerId ||
      event.pvb_wallet !== context.sourceWalletId ||
      event.pvb_reference !== single.id ||
      (event.pvb_destination_wallet != null &&
        event.pvb_destination_wallet !== context.destinationWalletId) ||
      (event.pvb_third_party_reference != null &&
        event.pvb_third_party_reference !== context.reference) ||
      single.status !== 'successful' ||
      single.category !== 'wallet_transfer' ||
      single.fee !== 0 ||
      single.customer_id !== crosswalk.transactionCustomerId ||
      single.source_wallet !== context.sourceWalletId ||
      single.destination_wallet !== context.destinationWalletId ||
      single.third_party_reference !== context.reference ||
      single.amount !== context.amountKobo ||
      (single.internal_reference != null &&
        single.internal_reference !== single.id) ||
      verification.status !== 'success' ||
      verification.reference !== context.reference ||
      verification.amount !== context.amountKobo ||
      source.id !== context.sourceWalletId ||
      destination.id !== context.destinationWalletId ||
      source.business_id !== context.businessId ||
      destination.business_id !== context.businessId ||
      source.currency !== 'NGN' ||
      destination.currency !== 'NGN' ||
      source.status !== 'active' ||
      destination.status !== 'active' ||
      (event.eventData.amount !== undefined &&
        event.eventData.amount !== context.amountKobo) ||
      (event.eventData.currency !== undefined &&
        event.eventData.currency !== 'NGN') ||
      (event.eventData.transaction_id !== undefined &&
        !aliases.includes(String(event.eventData.transaction_id)))
    )
      return { status: 'deferred' as const };
    return {
      status: 'verified' as const,
      proof: schemas.proof.parse({
        ...context,
        providerTransactionId: single.id,
        transactionAliases: aliases,
        eventId: event.eventId,
        bodyDigest: input.bodyDigest,
        crosswalkDigest: crosswalk.evidenceSha256,
        observedAt: new Date(now).toISOString(),
        feeKobo: 0,
        currency: 'NGN',
      }),
    };
  } catch {
    return { status: 'deferred' as const };
  }
}
