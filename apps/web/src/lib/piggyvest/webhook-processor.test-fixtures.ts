export const interestEvent = {
  eventId: '01K8TESTINTEREST001',
  eventType: 'interest-payout.success',
  eventCategory: 'interest-payout',
  customer_id: 'faas-customer-synthetic-001',
  eventData: {
    id: 'faas-interest-synthetic-001',
    amount: 95000,
    destination_wallet: 'faas-wallet-synthetic-001',
    destination_wallet_balance: 1095000,
    destination_wallet_ledger_balance: 1095000,
    reference: 'faas-ref-synthetic-002',
    timestamp: '2026-09-01T00:05:00.000Z',
    batch_id: 'batch-synthetic-001',
    break_down: {
      gross_interest_payout: 100000,
      withholding_tax: 5000,
      net_interest_payout: 95000,
    },
  },
  pvb_reference: 'pvb-txn-synthetic-002',
  pvb_wallet: 'pvb-wallet-synthetic-002',
  pvb_accrued_interest_wallet: 'pvb-wallet-synthetic-001',
  pvb_destination_wallet: null,
  pvb_third_party_reference: null,
} as const;

export const deferredEvent = {
  eventId: '4204dc18-efb3-44d0-b9a2-1362448d4f21',
  eventType: 'create-wallet.success',
  eventCategory: 'create_wallet',
  customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
  eventData: {},
  pvb_wallet: '923f843a-be7e-494a-bc5d-9f49f4cc640f',
} as const;

export const inflowEvent = {
  eventId: '01K8TESTINFLOW001',
  eventType: 'bank-transfer.inflow.success',
} as const;

export const restrictionCreatedEvent = {
  eventId: '01K8TESTRESTRICT001',
  eventType: 'restriction-created.success',
  eventCategory: 'restriction',
  customer_id: 'faas-customer-synthetic-001',
  eventData: {},
  pvb_wallet: 'pvb-wallet-synthetic-001',
} as const;

export const restrictionLiftedEvent = {
  ...restrictionCreatedEvent,
  eventId: '01K8TESTLIFT001',
  eventType: 'restriction-lifted.success',
} as const;
