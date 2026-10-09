import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { primaryCardTransferProviderSchemas as schemas } from '@/schemas/primary-wallet-card-transfer-provider';

export function assertPrimaryCardTransferPolicy(
  configuration: unknown,
  now = Date.now()
) {
  const config = schemas.configuration.parse(configuration);
  const actual = createHmac('sha256', config.policyIssuerKey)
    .update(config.policyBytes)
    .digest();
  if (!timingSafeEqual(actual, Buffer.from(config.policySignature, 'hex')))
    throw new Error('Transfer policy unavailable');
  const policy = schemas.policy.parse(JSON.parse(config.policyBytes));
  const runtime = config.runtime;
  // No integration-deadline check: the transfer worker only advances
  // pre-existing operations (reserve is the strict new-work gate), so a
  // post-expiry run drains in-flight transfers instead of stranding
  // charged-but-uncredited checkouts. Signatures, bindings, and the
  // observed-before-now ordering still fail closed.
  if (
    !Number.isFinite(now) ||
    now < Date.parse(policy.observedAt) ||
    Date.parse(policy.expiresAt) > Date.parse(runtime.expiresAt) ||
    policy.integrationId !== runtime.integrationId ||
    policy.environment !== runtime.environment ||
    policy.merchantId !== runtime.merchantId ||
    policy.businessId !== runtime.businessId ||
    policy.contractId !== runtime.crosswalkAuthority.contractId ||
    policy.evidenceIssuer !== runtime.crosswalkAuthority.evidenceIssuer ||
    policy.treasuryWebhookCustomerId !==
      runtime.crosswalkAuthority.treasuryWebhookCustomerId ||
    policy.transactionCustomerId !==
      runtime.crosswalkAuthority.transactionCustomerId
  )
    throw new Error('Transfer policy unavailable');
  return config;
}
