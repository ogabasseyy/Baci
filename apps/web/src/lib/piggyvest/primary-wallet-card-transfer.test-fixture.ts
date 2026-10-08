import { createHmac } from 'node:crypto';
import { primaryCardCustodyFixture as fixture } from './primary-wallet-card-custody.test-fixture';
import { primaryCardCustodyInboxFixture as inbox } from './primary-wallet-card-custody-inbox.test-fixture';

const policy = {
  authority: 'approved_reusable_primary_card_transfer_contract',
  integrationId: fixture.context.integrationId,
  merchantId: fixture.context.merchantId,
  businessId: fixture.context.businessId,
  environment: 'staging',
  ...fixture.configuration.crosswalkAuthority,
  evidenceSha256: 'c'.repeat(64),
  observedAt: '2026-10-07T19:59:59Z',
  expiresAt: fixture.configuration.expiresAt,
  transferEnabled: true,
  reusableBindingReady: true,
  exhaustiveAliasContractApproved: true,
};
const policyBytes = JSON.stringify(policy);
const policyIssuerKey = 'mock-approved-transfer-policy-key-00000';
const {
  custody: _custody,
  webhookSecret: _webhookSecret,
  ...runtime
} = fixture.configuration;
export const primaryCardTransferFixture = {
  environment: {
    ...inbox.environment,
    PIGGYVEST_PRIMARY_CARD_CUSTODY_PASSWORD: undefined,
    PIGGYVEST_PRIMARY_CARD_INTAKE_PASSWORD: undefined,
    PIGGYVEST_PRIMARY_CARD_TRANSFER_PROVIDER_ENABLED: 'true',
    PIGGYVEST_PRIMARY_CARD_TRANSFER_POLICY_BYTES: policyBytes,
    PIGGYVEST_PRIMARY_CARD_TRANSFER_POLICY_SIGNATURE: createHmac(
      'sha256',
      policyIssuerKey
    )
      .update(policyBytes)
      .digest('hex'),
    PIGGYVEST_PRIMARY_CARD_TRANSFER_POLICY_ISSUER_KEY: policyIssuerKey,
  },
  ...fixture,
  policy,
  configuration: {
    runtime: { ...runtime, transferOnly: true },
    policyBytes,
    policyIssuerKey,
    policySignature: createHmac('sha256', policyIssuerKey)
      .update(policyBytes)
      .digest('hex'),
  },
  command: {
    operationId: fixture.context.operationId,
    sourceWalletId: fixture.context.sourceWalletId,
    destinationWalletId: fixture.context.destinationWalletId,
    amountKobo: fixture.context.amountKobo,
    currency: 'NGN',
    reference: fixture.context.reference,
  },
};
