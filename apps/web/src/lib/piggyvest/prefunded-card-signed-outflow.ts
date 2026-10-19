import 'server-only';
import { prefundedCardProviderEvidenceSchemas as evidenceSchemas } from '@/schemas/prefunded-card-provider-evidence';
import { prefundedCardSignedOutflowSchemas as schemas } from '@/schemas/prefunded-card-signed-outflow';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';

export async function normalizePrefundedCardSignedOutflow(input: {
  configuration: ReturnType<typeof evidenceSchemas.configuration.parse>;
  envelope: ReturnType<typeof evidenceSchemas.envelope.parse>;
  observation: ReturnType<typeof evidenceSchemas.observation.parse>;
  fetchImplementation: typeof fetch;
  resolveDestination: (walletId: string) => Promise<{
    providerWalletId: string;
    providerCustomerId: string;
  } | null>;
}) {
  const parsed = schemas.signed.safeParse(input.envelope);
  if (!parsed.success) return null;
  const envelope = parsed.data;
  const configuration = evidenceSchemas.configuration.parse(
    input.configuration
  );
  const request = (path: string) =>
    requestPrefundedCardProviderJson({
      url: `${configuration.piggyvest.apiBaseUrl}${path}`,
      token: configuration.piggyvest.apiSecret,
      timeoutMs: configuration.piggyvest.timeoutMs,
      maxResponseBytes: configuration.piggyvest.maxResponseBytes,
      fetchImplementation: input.fetchImplementation,
      init: { method: 'GET' },
    });
  const result = schemas.transaction.safeParse(
    await request(
      `/api/v1/transaction/verify?reference=${encodeURIComponent(envelope.pvb_third_party_reference)}&wallet_id=${encodeURIComponent(envelope.pvb_wallet)}`
    )
  );
  if (!result.success) return null;
  const transaction = result.data.data;
  const data = envelope.eventData;
  if (
    transaction.third_party_reference !== envelope.pvb_third_party_reference ||
    transaction.id !== data.third_party_reference ||
    transaction.reference !== data.reference ||
    transaction.amount !== data.amount ||
    transaction.source_wallet !== envelope.pvb_wallet ||
    transaction.destination_wallet !== envelope.pvb_destination_wallet ||
    transaction.customer_id !== configuration.piggyvest.expectedBusinessId ||
    (transaction.business_id !== undefined &&
      transaction.business_id !== transaction.customer_id) ||
    (transaction.destination_customer_id !== undefined &&
      transaction.destination_customer_id !== envelope.customer_id)
  )
    return null;
  const source = schemas.wallet.parse(
    await request(
      `/api/v1/wallet/${encodeURIComponent(transaction.source_wallet)}`
    )
  ).data;
  const destination = schemas.wallet.parse(
    await request(
      `/api/v1/wallet/${encodeURIComponent(transaction.destination_wallet)}`
    )
  ).data;
  if (
    source.id !== transaction.source_wallet ||
    destination.id !== transaction.destination_wallet ||
    source.faas_wallet_identifier !== data.source_wallet ||
    destination.faas_wallet_identifier !== data.destination_wallet ||
    source.faas_wallet_identifier === destination.faas_wallet_identifier ||
    source.business_id !== transaction.customer_id ||
    destination.business_id !== source.business_id ||
    configuration.piggyvest.expectedCurrency !== source.currency ||
    destination.currency !== source.currency ||
    !destination.api_customer_id
  )
    return null;
  const mapping = await input.resolveDestination(destination.id);
  if (
    !mapping ||
    mapping.providerWalletId !== destination.id ||
    mapping.providerCustomerId !== envelope.customer_id
  )
    return null;
  const listed = schemas.wallets.parse(
    await request(
      `/api/v1/wallet/api/wallet-type?customer_id=${encodeURIComponent(destination.api_customer_id)}&limit=100`
    )
  );
  if (
    !listed.data.paginatedPayload.edges.some(
      (wallet) =>
        wallet.id === destination.id &&
        wallet.api_customer_id === destination.api_customer_id &&
        wallet.business_id === destination.business_id &&
        wallet.currency === destination.currency &&
        wallet.faas_wallet_identifier === destination.faas_wallet_identifier
    )
  )
    return null;
  return evidenceSchemas.observation.parse({
    ...input.observation,
    eventCategory: 'wallet-transfer',
    status: 'verified',
    kind: 'internal_transfer',
    providerTransactionId: transaction.id,
    reference: transaction.third_party_reference,
    references: [
      ...new Set([
        ...input.observation.references,
        transaction.id,
        transaction.reference,
        transaction.third_party_reference,
      ]),
    ],
    sourceWalletId: source.id,
    destinationWalletId: destination.id,
    destinationCustomerId: envelope.customer_id,
    amountKobo: transaction.amount,
    feeKobo: transaction.fee,
    currency: destination.currency,
  });
}
