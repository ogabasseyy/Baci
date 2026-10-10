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
  // The policy's own expiry is enforced: a lapsed authorization stops
  // the worker (per the worker README) instead of authorizing treasury
  // transfers indefinitely. The integration deadline does NOT stop the
  // worker — it only advances pre-existing operations (reserve is the
  // strict new-work gate) — so draining past it requires a freshly
  // signed policy whose expiry covers now. Signatures, bindings, and
  // the observed-before-now ordering still fail closed.
  if (
    !Number.isFinite(now) ||
    now < Date.parse(policy.observedAt) ||
    now > Date.parse(policy.expiresAt) ||
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
