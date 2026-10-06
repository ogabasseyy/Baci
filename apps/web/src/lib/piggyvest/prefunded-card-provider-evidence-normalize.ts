import 'server-only';
import { prefundedCardProviderEvidenceSchemas as schemas } from '@/schemas/prefunded-card-provider-evidence';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import { retrievePiggyvestStagingWallet } from './read-only-client';

type Configuration = ReturnType<typeof schemas.configuration.parse>;
type Envelope = ReturnType<typeof schemas.envelope.parse>;
type Observation = ReturnType<typeof schemas.observation.parse>;

export async function normalizePrefundedCardProviderEvidence({
  configuration,
  envelope,
  observation,
  fetchImplementation,
  resolveDestination,
}: {
  configuration: Configuration;
  envelope: Envelope;
  observation: Observation;
  fetchImplementation: typeof fetch;
  resolveDestination: (
    walletId: string
  ) => Promise<{ providerWalletId: string; providerCustomerId: string } | null>;
}): Promise<Observation | null> {
  const bank =
    envelope.eventType === 'bank-transfer.inflow.success' &&
    ['bank-transfer', 'inflow_transaction'].includes(envelope.eventCategory);
  const internal =
    envelope.eventType === 'wallet-transfer.outflow.success' &&
    envelope.eventCategory === 'wallet-transfer';
  if ((!bank && !internal) || !envelope.pvb_reference || !envelope.pvb_wallet)
    return null;
  const bankData = bank ? schemas.bank.safeParse(envelope.eventData) : null;
  if (
    bank &&
    (!bankData?.success || bankData.data.customer_id !== envelope.customer_id)
  )
    return null;
  const request = (path: string) =>
    requestPrefundedCardProviderJson({
      url: `${configuration.piggyvest.apiBaseUrl}${path}`,
      token: configuration.piggyvest.apiSecret,
      timeoutMs: configuration.piggyvest.timeoutMs,
      maxResponseBytes: configuration.piggyvest.maxResponseBytes,
      fetchImplementation,
      init: { method: 'GET' },
    });
  const single = schemas.single.parse(
    await request(
      `/api/v1/transaction/${encodeURIComponent(envelope.pvb_reference)}?wallet_id=${encodeURIComponent(envelope.pvb_wallet)}`
    )
  ).data;
  const businessBankSummary = bank && single.category === 'bank-inflow';
  if (
    single.id !== envelope.pvb_reference ||
    single.customer_id !==
      (businessBankSummary
        ? configuration.piggyvest.expectedBusinessId
        : envelope.customer_id) ||
    single.status !== 'successful' ||
    single.fee !== 0
  )
    return null;
  if (
    bank &&
    !businessBankSummary &&
    (single.source_wallet !== '' || single.category !== 'bank_transfer_inflow')
  )
    return null;
  if (
    businessBankSummary &&
    (single.source_wallet !== envelope.pvb_wallet ||
      single.destination_wallet !== '')
  )
    return null;
  const creditedWalletId = businessBankSummary
    ? single.source_wallet
    : single.destination_wallet;
  if (
    bankData?.success &&
    creditedWalletId !== envelope.pvb_wallet &&
    creditedWalletId !== bankData.data.destination_wallet_id
  )
    return null;
  if (
    internal &&
    (single.source_wallet !== envelope.pvb_wallet ||
      single.source_wallet === single.destination_wallet ||
      single.category === 'bank_transfer_inflow')
  )
    return null;
  if (
    envelope.pvb_destination_wallet &&
    envelope.pvb_destination_wallet !== creditedWalletId
  )
    return null;
  const wallet = await retrievePiggyvestStagingWallet({
    configuration: configuration.piggyvest,
    walletId: creditedWalletId,
    fetchImplementation,
  });
  if (wallet.data.currency !== 'NGN') return null;
  if (businessBankSummary && !wallet.data.api_customer_id) return null;
  const destination = await resolveDestination(wallet.data.id);
  if (!destination || destination.providerWalletId !== wallet.data.id)
    return null;
  const apiCustomerId =
    wallet.data.api_customer_id ?? destination.providerCustomerId;
  const wallets = schemas.wallets.parse(
    await request(
      `/api/v1/wallet/api/wallet-type?customer_id=${encodeURIComponent(apiCustomerId)}&limit=100`
    )
  );
  if (
    !wallets.data.paginatedPayload.edges.some(
      (entry) =>
        entry.id === wallet.data.id &&
        entry.business_id === wallet.data.business_id &&
        entry.currency === wallet.data.currency &&
        (wallet.data.api_customer_id
          ? entry.api_customer_id === apiCustomerId
          : entry.api_customer_id == null ||
            entry.api_customer_id === apiCustomerId)
    )
  )
    return null;
  if (
    bank &&
    destination.providerCustomerId !==
      (businessBankSummary ? envelope.customer_id : single.customer_id)
  )
    return null;
  const reference = single.third_party_reference || single.reference;
  let amountKobo: number;
  if (bankData?.success) {
    if (
      single.reference !== bankData.data.reference ||
      single.amount !== bankData.data.amount ||
      (single.session_id && single.session_id !== bankData.data.session_id)
    )
      return null;
    amountKobo = bankData.data.amount;
  } else {
    const tsq = schemas.tsq.parse(
      await request(
        `/api/v1/transaction/verify?reference=${encodeURIComponent(reference)}&wallet_id=${encodeURIComponent(single.source_wallet)}`
      )
    ).data;
    if (
      tsq.status !== 'success' ||
      tsq.reference !== reference ||
      tsq.amount !== single.amount
    )
      return null;
    if (
      envelope.eventData.amount !== undefined &&
      envelope.eventData.amount !== tsq.amount
    )
      return null;
    if (
      envelope.eventData.currency !== undefined &&
      envelope.eventData.currency !== wallet.data.currency
    )
      return null;
    amountKobo = tsq.amount;
  }
  const references = [
    ...new Set(
      [
        ...observation.references,
        single.id,
        single.reference,
        single.third_party_reference,
        single.internal_reference,
        single.session_id,
      ].filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0
      )
    ),
  ];
  return schemas.observation.parse({
    ...observation,
    status: 'verified',
    kind: bank ? 'bank_inflow' : 'internal_transfer',
    providerTransactionId: single.id,
    reference,
    references,
    sourceWalletId: businessBankSummary ? '' : single.source_wallet,
    destinationWalletId: creditedWalletId,
    destinationCustomerId: destination.providerCustomerId,
    amountKobo,
    feeKobo: single.fee,
    currency: wallet.data.currency,
    creditedAt: bankData?.success ? (bankData.data.timestamp ?? null) : null,
  });
}
