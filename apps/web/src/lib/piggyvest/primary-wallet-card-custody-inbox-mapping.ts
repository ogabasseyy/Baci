import 'server-only';
import { prefundedCardProviderEvidenceSchemas as provider } from '@/schemas/prefunded-card-provider-evidence';
import { primaryCardCustodyInboxSchemas as schemas } from '@/schemas/primary-wallet-card-custody-inbox';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import type { createPrimaryCardCustodyExecutor } from './primary-wallet-card-custody-executor';

export function createPrimaryCardCustodyInboxMapping(input: {
  configuration: unknown;
  capability: string;
  execute: ReturnType<typeof createPrimaryCardCustodyExecutor>;
  fetchImplementation: typeof fetch;
}) {
  const config = schemas.runtime.parse(input.configuration);
  return async (selected: unknown) => {
    const event = schemas.envelope.parse(selected);
    if (
      !event.pvb_reference ||
      !event.pvb_wallet ||
      event.customer_id !== config.crosswalkAuthority.treasuryWebhookCustomerId
    )
      return null;
    const origin =
      config.environment === 'staging'
        ? 'https://staging.piggyvest.business'
        : 'https://api.piggyvest.business';
    const response = await requestPrefundedCardProviderJson({
      url: `${origin}/api/v1/transaction/${encodeURIComponent(event.pvb_reference)}?wallet_id=${encodeURIComponent(event.pvb_wallet)}`,
      token: config.apiToken,
      timeoutMs: 5000,
      maxResponseBytes: 65536,
      fetchImplementation: input.fetchImplementation,
      init: { method: 'GET' },
    });
    const parsed = provider.single.safeParse(response);
    if (!parsed.success) return null;
    const single = parsed.data.data;
    if (
      single.id !== event.pvb_reference ||
      single.source_wallet !== event.pvb_wallet ||
      single.customer_id !== config.crosswalkAuthority.transactionCustomerId ||
      single.category !== 'wallet_transfer' ||
      single.status !== 'successful' ||
      !single.third_party_reference ||
      !/^pvb-primary-transfer-[0-9a-f-]{36}$/.test(
        single.third_party_reference
      ) ||
      (event.pvb_third_party_reference != null &&
        event.pvb_third_party_reference !== single.third_party_reference)
    )
      return null;
    return schemas.operation.parse(
      await input.execute('inboxResolve', [
        input.capability,
        single.third_party_reference,
        event.pvb_wallet,
      ])
    );
  };
}
