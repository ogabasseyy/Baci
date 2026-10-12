const envelope = {
  eventId: '01M3YP771123DWC9Y8Y4814Z8Y',
  eventType: 'wallet-transfer.outflow.success',
  eventCategory: 'wallet_transfer',
  customer_id: 'c096507d-dc32-45d2-9c01-871a27abfd10',
  pvb_reference: 'PVB01M3YP7BF72MD3PXVY2G8ZXCS0',
  pvb_wallet: '01M238A0V75387H4HZ15YFWGX3',
  pvb_destination_wallet: '01M3W0Y93XHJY9RPQ2G75X81WG',
  pvb_third_party_reference: 'pvbt-ff561046-58e7-428d-9163-f6e60b0dab65',
  eventData: {
    id: '34c57f9b-8697-46a9-954f-b93bfd888a36',
    transaction_id: '2d3ee34a-74e9-4992-b0c2-f8a653e4ff02',
    source_wallet: '01M238A757Y931HHB238T7MCFM',
    destination_wallet: '01M3W0YENHMFJ8Z9FS76E3CC6T',
    amount: 10000,
    currency: 'NGN',
    fee: null,
    status: 'COMPLETED',
    reference: '01M3YP6VMSZX61CMB5V4Z07RAJ',
    internal_reference: '01M3YP6VMSZX61CMB5V4Z07RAJ',
    third_party_reference: 'PVB01M3YP6SFJQTJQWE83SC5RMX1V',
    initiator_reference: 'PVB01M3YP6SFJQTJQWE83SC5RMX1V',
  },
};
const businessId = '01M2381RG34HQJMHQKE7DWDACR';
const apiCustomerId = '01M2T3PAHG3P5A32REX8MH3HD7';
const transaction = {
  status: true,
  data: {
    id: envelope.eventData.third_party_reference,
    internal_reference: envelope.eventData.third_party_reference,
    reference: envelope.eventData.reference,
    third_party_reference: envelope.pvb_third_party_reference,
    customer_id: businessId,
    source_wallet: envelope.pvb_wallet,
    destination_wallet: envelope.pvb_destination_wallet,
    status: 'successful',
    amount: 10000,
    fee: 0,
  },
};
const sourceWallet = {
  status: true,
  data: {
    id: envelope.pvb_wallet,
    faas_wallet_identifier: envelope.eventData.source_wallet,
    business_id: businessId,
    currency: 'NGN',
    status: 'active',
    balance: 0,
  },
};
const destinationWallet = {
  status: true,
  data: {
    id: envelope.pvb_destination_wallet,
    faas_wallet_identifier: envelope.eventData.destination_wallet,
    api_customer_id: apiCustomerId,
    business_id: businessId,
    currency: 'NGN',
    status: 'active',
    balance: 10000,
  },
};
const walletList = {
  status: true,
  data: { paginatedPayload: { edges: [{ ...destinationWallet.data }] } },
};
const configuration = {
  integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
  systemIdentifier: '7685292944002592802',
  webhookSecret: 'signed-outflow-test-only-secret',
  piggyvest: {
    apiSecret: 'signed-outflow-test-only-api-secret',
    expectedBusinessId: businessId,
    expectedCurrency: 'NGN',
  },
};

export const prefundedCardSignedOutflowFixture = {
  envelope,
  transaction,
  sourceWallet,
  destinationWallet,
  walletList,
  configuration,
};
