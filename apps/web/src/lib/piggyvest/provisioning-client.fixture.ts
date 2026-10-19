const configuration = {
  environment: 'staging',
  integrationId: '44444444-4444-4444-8444-444444444444',
  expectedMerchantId: '11111111-1111-4111-8111-111111111111',
  expectedProjectId: 'synthetic-project',
  actualProjectId: 'synthetic-project',
  allowlistedCustomerIds: ['22222222-2222-4222-8222-222222222222'],
  provisioningApproved: true,
  syntheticIdentityApproved: true,
  defaultInterestRoutingVerified: true,
  fingerprintKey: 'synthetic-fingerprint-key-at-least-32-bytes',
  apiSecret: 'synthetic-provider-secret',
  expectedBusinessId: 'synthetic-business',
};

export const provisioningClientFixture = {
  intentId: '55555555-5555-4555-8555-555555555555',
  claimToken: '66666666-6666-4666-8666-666666666666',
  configuration,
  command: {
    merchantId: configuration.expectedMerchantId,
    customerId: configuration.allowlistedCustomerIds[0],
    kind: 'create_customer',
    bvn: '00000000000',
    email: 'synthetic@example.test',
    name: 'Synthetic Customer',
    phone: '+2340000000000',
    enableInterestAccrual: false,
    interestPayout: 'own_wallet',
  },
  accepted: {
    status: true,
    data: {
      customer_id: 'synthetic-customer',
      wallet_id: 'synthetic-default-wallet',
      new_customer: true,
    },
  },
};
