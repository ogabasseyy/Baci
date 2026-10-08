import 'server-only';
import { prefundedCardClaimedRequestSchema } from '@/schemas/prefunded-card-claimed-request';
import { prefundedCardProviderSchemas } from '@/schemas/prefunded-card-provider';
import { prefundedCardTransferVerificationSchemas as schemas } from '@/schemas/prefunded-card-transfer-verification';
import { normalizePrefundedCardTransfer } from './normalize-prefunded-card-transfer';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';

type Claim = ReturnType<typeof prefundedCardClaimedRequestSchema.parse>;

export async function collectPrefundedCardTransferProof(input: {
  settings: unknown;
  claim: unknown;
  fetchImplementation: typeof fetch;
  expectedSystemIdentifier?: string;
  resolveOwnership?: (claim: Claim) => Promise<unknown>;
  requireRichResponse?: true;
}) {
  const settings = prefundedCardProviderSchemas.settings.parse(input.settings);
  const claim = prefundedCardClaimedRequestSchema.parse(input.claim);
  if (
    claim.integrationId !== settings.scope.integrationId ||
    claim.merchantId !== settings.scope.merchantId ||
    claim.treasuryBindingId !== settings.scope.treasuryBindingId ||
    claim.sourceWalletId !== settings.scope.sourceWalletId ||
    claim.businessId !== settings.piggyvest.expectedBusinessId ||
    claim.currency !== settings.piggyvest.expectedCurrency
  )
    return { outcome: 'reconciliation_required' } as const;
  const retrievedAt = new Date().toISOString();
  const request = (path: string) =>
    requestPrefundedCardProviderJson({
      url: `${settings.piggyvest.apiBaseUrl}${path}`,
      token: settings.piggyvest.apiSecret,
      timeoutMs: settings.piggyvest.timeoutMs,
      maxResponseBytes: settings.piggyvest.maxResponseBytes,
      fetchImplementation: input.fetchImplementation,
      init: { method: 'GET' },
    });
  const response = await request(
    `/api/v1/transaction/verify?reference=${encodeURIComponent(claim.transferReference)}&wallet_id=${encodeURIComponent(claim.sourceWalletId)}`
  );
  if (
    !input.requireRichResponse &&
    schemas.normalized.safeParse(response).success
  )
    return normalizePrefundedCardTransfer({ claim, response });
  const rich = schemas.rich.safeParse(response);
  if (
    !rich.success ||
    !input.resolveOwnership ||
    !input.expectedSystemIdentifier
  )
    return { outcome: 'deferred' } as const;
  const data = rich.data.data;
  if (
    data.third_party_reference !== claim.transferReference ||
    data.amount !== claim.amountKobo ||
    data.source_wallet !== claim.sourceWalletId ||
    data.destination_wallet !== claim.destinationWalletId ||
    data.customer_id !== claim.businessId
  )
    return { outcome: 'deferred' } as const;
  try {
    const ownership = schemas.ownership.safeParse(
      await input.resolveOwnership(claim)
    );
    if (!ownership.success) return { outcome: 'deferred' } as const;
    const sourceWallet = await request(
      `/api/v1/wallet/${encodeURIComponent(claim.sourceWalletId)}`
    );
    const destinationWallet = await request(
      `/api/v1/wallet/${encodeURIComponent(claim.destinationWalletId)}`
    );
    return normalizePrefundedCardTransfer({
      claim,
      response,
      expectedSystemIdentifier: input.expectedSystemIdentifier,
      corroboration: {
        retrievedAt,
        sourceWallet,
        destinationWallet,
        ownership: ownership.data,
      },
    });
  } catch {
    return { outcome: 'deferred' } as const;
  }
}
