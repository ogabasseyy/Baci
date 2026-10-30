const wallet = {
  id: 'source-wallet',
  business_id: 'business',
  api_customer_id: 'provider-customer',
  currency: 'NGN',
  status: 'active',
  is_frozen: false,
};
const transaction = {
  id: 'transfer-id',
  business_id: 'business',
  wallet_id: 'source-wallet',
  api_customer_id: 'provider-customer',
  currency: 'NGN',
  type: 'debit',
  category: 'p2p',
  status: 'successful',
  amount: -10000,
  charge: 0,
  third_party_reference: 'reserved-reference',
  provider_reference: 'provider-reference',
};
const singleTransaction = {
  id: transaction.id,
  customer_id: 'business',
  source_wallet: 'source-wallet',
  destination_wallet: 'destination-wallet',
  status: 'successful',
  amount: 10000,
  fee: 0,
  reference: 'provider-reference',
  third_party_reference: transaction.third_party_reference,
  internal_reference: transaction.id,
};
const productionSingleTransaction = {
  ...singleTransaction,
  category: 'p2p',
};

export const savingsIdentityFixture = {
  reservation: {
    operationId: '00000000-0000-4000-8000-000000000001',
    goalId: '00000000-0000-4000-8000-000000000002',
    amountKobo: 10000,
    sourceWalletId: wallet.id,
    destinationWalletId: 'destination-wallet',
    reference: transaction.third_party_reference,
    businessId: wallet.business_id,
    providerCustomerId: wallet.api_customer_id,
  },
  providerResponse: {
    status: true,
    data: {
      status: 'successful',
      id: transaction.id,
      internal_reference: transaction.id,
      reference: transaction.provider_reference,
      third_party_reference: transaction.third_party_reference,
      amount: 10000,
      fee: 0,
      customer_id: wallet.business_id,
      source_wallet: wallet.id,
      destination_wallet: 'destination-wallet',
      business_id: wallet.business_id,
      currency: wallet.currency,
      destination_customer_id: wallet.api_customer_id,
    },
  },
  wallet,
  transaction,
  singleTransaction,
  productionSingleTransaction,
  page: {
    edges: [transaction],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
};
