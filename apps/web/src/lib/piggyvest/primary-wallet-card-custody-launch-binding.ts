import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { prefundedCardProviderEvidenceSchemas as provider } from '@/schemas/prefunded-card-provider-evidence';
import { primaryWalletCardCustodySchemas as custody } from '@/schemas/primary-wallet-card-custody';
import { primaryCardCustodyLaunchSchemas as launch } from '@/schemas/primary-wallet-card-custody-launch';

export function createPrimaryCardCustodyLaunchBinding(input: {
  rawBytes: Uint8Array;
  approval: unknown;
  configuration: unknown;
  now?: () => number;
}) {
  const config = custody.runtime.parse(input.configuration);
  const approval = launch.approval.parse(input.approval);
  const bytes = Buffer.from(input.rawBytes);
  if (
    bytes.length === 0 ||
    bytes.length > 1048576 ||
    createHash('sha256').update(bytes).digest('hex') !== approval.sha256 ||
    !timingSafeEqual(
      createHmac('sha256', approval.issuerKey).update(bytes).digest(),
      Buffer.from(approval.signature, 'hex')
    )
  )
    throw new Error('Approved crosswalk delivery unavailable');
  const binding = launch.binding.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  );
  const clock = input.now ?? Date.now;
  const verify = () => {
    const now = clock();
    if (
      !Number.isFinite(now) ||
      now >= Date.parse(binding.expiresAt) ||
      now >= Date.parse(config.expiresAt) ||
      Date.parse(binding.expiresAt) > Date.parse(config.expiresAt) ||
      binding.integrationId !== config.integrationId ||
      binding.environment !== config.environment
    )
      throw new Error('Approved crosswalk delivery unavailable');
  };
  verify();
  if (
    new Set(binding.records.map((record) => record.operationId)).size !==
    binding.records.length
  )
    throw new Error('Approved crosswalk delivery unavailable');
  return (selected: unknown, observed: unknown) =>
    Promise.resolve().then(() => {
      verify();
      const context = custody.context.parse(selected);
      const single = provider.single.parse(observed).data;
      const record = binding.records.find(
        (record) => record.operationId === context.operationId
      );
      if (!record) return null;
      const crosswalk = record.crosswalk;
      if (
        context.integrationId !== config.integrationId ||
        context.environment !== config.environment ||
        crosswalk.integrationId !== context.integrationId ||
        crosswalk.merchantId !== context.merchantId ||
        crosswalk.customerId !== context.customerId ||
        crosswalk.businessId !== context.businessId ||
        crosswalk.publicWalletId !== context.destinationWalletId ||
        crosswalk.webhookCustomerId !== context.destinationCustomerId ||
        crosswalk.canonicalTransactionId !== single.id ||
        single.third_party_reference !== context.reference ||
        crosswalk.contractId !== config.crosswalkAuthority.contractId ||
        crosswalk.evidenceIssuer !== config.crosswalkAuthority.evidenceIssuer ||
        crosswalk.treasuryWebhookCustomerId !==
          config.crosswalkAuthority.treasuryWebhookCustomerId ||
        crosswalk.transactionCustomerId !==
          config.crosswalkAuthority.transactionCustomerId ||
        clock() < Date.parse(crosswalk.observedAt) ||
        clock() >= Date.parse(crosswalk.expiresAt) ||
        Date.parse(crosswalk.expiresAt) > Date.parse(binding.expiresAt)
      )
        throw new Error('Approved crosswalk scope unavailable');
      return crosswalk;
    });
}
