const claim = {
  operationId: '10000000-0000-4000-8000-000000000001',
  integrationId: '10000000-0000-4000-8000-000000000002',
  merchantId: '10000000-0000-4000-8000-000000000003',
  customerId: '10000000-0000-4000-8000-000000000004',
  goalId: '10000000-0000-4000-8000-000000000005',
  treasuryBindingId: '10000000-0000-4000-8000-000000000006',
  businessId: 'business_1',
  sourceWalletId: 'wallet_source',
  destinationWalletId: 'wallet_destination',
  destinationCustomerId: 'customer_destination',
  savedMethodId: '10000000-0000-4000-8000-000000000007',
  amountKobo: 5000,
  currency: 'NGN',
  collectionReference: 'collection-1',
  transferReference: 'transfer-1',
};

const providerSettings = {
  paystackSecret: 'sk_test_example',
  piggyvest: {
    apiSecret: 'pv_staging_example',
    expectedBusinessId: 'business_1',
    expectedCurrency: 'NGN',
    timeoutMs: 500,
    maxResponseBytes: 1024,
  },
  scope: {
    integrationId: claim.integrationId,
    merchantId: claim.merchantId,
    treasuryBindingId: claim.treasuryBindingId,
    sourceWalletId: claim.sourceWalletId,
  },
};

const savedMethod = {
  savedMethodId: claim.savedMethodId,
  merchantId: claim.merchantId,
  customerId: claim.customerId,
  email: 'customer@example.test',
  authorizationCode: 'AUTH_test_authorization',
  paystackCustomerCode: 'CUS_test_customer',
  domain: 'test',
  reusable: true,
  active: true,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const prefundedCardProviderTestFixture = {
  claim,
  providerSettings,
  savedMethod,
  jsonResponse,
};
