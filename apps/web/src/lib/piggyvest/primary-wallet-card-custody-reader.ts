import 'server-only';
import { prefundedCardProviderEvidenceSchemas } from '@/schemas/prefunded-card-provider-evidence';
import { primaryWalletCardCustodySchemas as schemas } from '@/schemas/primary-wallet-card-custody';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';

export function createPrimaryCardCustodyReader(input: {
  configuration: unknown;
  fetchImplementation: typeof fetch;
  resolveAuthenticatedCrosswalk: (
    context: ReturnType<typeof schemas.context.parse>,
    single: unknown
  ) => Promise<unknown>;
  now?: () => number;
}) {
  const config = schemas.runtime.parse(input.configuration);
  return async (selected: unknown, envelope: unknown) => {
    const context = schemas.context.parse(selected);
    const event = prefundedCardProviderEvidenceSchemas.envelope.parse(envelope);
    const now = (input.now ?? Date.now)();
    // Live provider reads stay available past the evidence window so the
    // worker can drain; settlement freshness is enforced by the DB fence
    // (proof observedAt within 60s), not by this clock.
    if (
      context.integrationId !== config.integrationId ||
      context.merchantId !== config.merchantId ||
      context.businessId !== config.businessId ||
      context.environment !== config.environment ||
      !Number.isFinite(now) ||
      event.eventType !== 'wallet-transfer.outflow.success' ||
      event.pvb_wallet !== context.sourceWalletId ||
      !event.pvb_reference
    )
      throw new Error('Custody observation unavailable');
    const origin =
      config.environment === 'staging'
        ? 'https://staging.piggyvest.business'
        : 'https://api.piggyvest.business';
    const request = (path: string) =>
      requestPrefundedCardProviderJson({
        url: `${origin}${path}`,
        token: config.apiToken,
        timeoutMs: 5000,
        maxResponseBytes: 65536,
        fetchImplementation: input.fetchImplementation,
        init: { method: 'GET' },
      });
    const single = await request(
      `/api/v1/transaction/${encodeURIComponent(event.pvb_reference)}?wallet_id=${encodeURIComponent(context.sourceWalletId)}`
    );
    const verification = await request(
      `/api/v1/transaction/verify?reference=${encodeURIComponent(context.reference)}&wallet_id=${encodeURIComponent(context.sourceWalletId)}`
    );
    const sourceWallet = await request(
      `/api/v1/wallet/${encodeURIComponent(context.sourceWalletId)}`
    );
    const destinationWallet = await request(
      `/api/v1/wallet/${encodeURIComponent(context.destinationWalletId)}`
    );
    const resolved = await input.resolveAuthenticatedCrosswalk(context, single);
    const parsed = schemas.crosswalk.safeParse(resolved);
    const crosswalk =
      parsed.success &&
      parsed.data.contractId === config.crosswalkAuthority.contractId &&
      parsed.data.evidenceIssuer === config.crosswalkAuthority.evidenceIssuer &&
      parsed.data.treasuryWebhookCustomerId ===
        config.crosswalkAuthority.treasuryWebhookCustomerId &&
      parsed.data.transactionCustomerId ===
        config.crosswalkAuthority.transactionCustomerId
        ? parsed.data
        : null;
    return { single, verification, sourceWallet, destinationWallet, crosswalk };
  };
}
