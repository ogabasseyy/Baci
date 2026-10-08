import { prefundedCardProviderTestFixture } from './prefunded-card-provider.test-fixture';

const claim = {
  ...prefundedCardProviderTestFixture.claim,
  amountKobo: 10000,
  transferReference: 'pvbt-synthetic-transfer',
};
const ownership = {
  observedAt: '2026-10-02T16:00:00.000Z',
  binding: {
    integrationId: claim.integrationId,
    merchantId: claim.merchantId,
    customerId: claim.customerId,
    goalId: claim.goalId,
    systemIdentifier: '123',
    providerWalletId: claim.destinationWalletId,
    providerCustomerId: claim.destinationCustomerId,
    enabled: true,
  },
  crosswalk: {
    authority: 'provider_authenticated_crosswalk',
    integrationId: claim.integrationId,
    merchantId: claim.merchantId,
    customerId: claim.customerId,
    businessId: claim.businessId,
    publicWalletId: claim.destinationWalletId,
    apiCustomerId: 'synthetic-api-customer',
    webhookCustomerId: claim.destinationCustomerId,
    evidenceSha256: 'a'.repeat(64),
    expiresAt: '2026-10-06T15:59:10.000Z',
  },
};
const transaction = {
  status: true,
  data: {
    id: 'PVBsynthetic-transfer-id',
    internal_reference: 'PVBsynthetic-transfer-id',
    reference: 'synthetic-provider-reference',
    third_party_reference: claim.transferReference,
    status: 'successful',
    customer_id: claim.businessId,
    source_wallet: claim.sourceWalletId,
    destination_wallet: claim.destinationWalletId,
    amount: 10000,
    fee: 0,
  },
};
const sourceWallet = {
  status: true,
  data: {
    id: claim.sourceWalletId,
    business_id: claim.businessId,
    currency: 'NGN',
    status: 'active',
    balance: 0,
  },
};
const destinationWallet = {
  status: true,
  data: {
    id: claim.destinationWalletId,
    business_id: claim.businessId,
    api_customer_id: ownership.crosswalk.apiCustomerId,
    currency: 'NGN',
    status: 'active',
    balance: 10000,
  },
};

export const prefundedCardTransferVerificationFixture = {
  claim,
  ownership,
  transaction,
  sourceWallet,
  destinationWallet,
  settings: prefundedCardProviderTestFixture.providerSettings,
};
