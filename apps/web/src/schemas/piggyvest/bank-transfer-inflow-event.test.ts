import { describe, expect, it } from 'vitest';
import { bankTransferInflowSuccessEventSchema } from './bank-transfer-inflow-event';

const inflowEvent = {
  eventId: '01K8TESTINFLOW001',
  eventType: 'bank-transfer.inflow.success',
  eventCategory: 'bank-transfer',
  customer_id: 'faas-customer-synthetic-001',
  eventData: {
    id: 'faas-txn-synthetic-001',
    customer_id: 'faas-customer-synthetic-001',
    source_wallet_id: '',
    destination_wallet_id: 'faas-wallet-synthetic-001',
    type: 'inflow',
    category: 'bank_transfer_inflow',
    amount: 1750000,
    currency: 'NGN',
    narration: 'Transfer from SYNTHETIC SENDER',
    ip_address: '',
    transaction_id: 'provider-txn-synthetic-001',
    timestamp: '2026-09-15T10:12:00.000Z',
    status: 'success',
    third_party_reference: 'synthetic-third-party-ref',
    initiator_reference: 'synthetic-initiator-ref',
    internal_reference: 'synthetic-internal-ref',
    attempts: 1,
    provider: 'wema',
    destination_wallet_balance: 5000000,
    destination_wallet_ledger_balance: 5000000,
    destination_transaction_balance: 5000000,
    reference: 'faas-ref-synthetic-001',
    recipient_bank_account_number: '9000000001',
    recipient_bank_account_name: 'SYNTHETIC LTD',
    sender_bank_account_number: '0000000001',
    sender_bank_name: 'Synthetic Bank',
    sender_name: 'SYNTHETIC SENDER',
    session_id: '000000000001',
    fee: 0,
  },
  pvb_reference: 'pvb-txn-synthetic-001',
  pvb_wallet: 'pvb-wallet-synthetic-001',
  pvb_destination_wallet: null,
  pvb_third_party_reference: null,
  pvb_schedule_payment_id: null,
  pvb_destination_account_creation_reference: null,
  pvb_meta: null,
};

describe('bankTransferInflowSuccessEventSchema', () => {
  it('accepts the provider-shaped inflow payload', () => {
    // Arrange & Act
    const result = bankTransferInflowSuccessEventSchema.safeParse(inflowEvent);

    // Assert
    expect(result.success).toBe(true);
  });

  it('rejects a mismatched event type', () => {
    // Arrange & Act
    const result = bankTransferInflowSuccessEventSchema.safeParse({
      ...inflowEvent,
      eventType: 'interest-payout.success',
    });

    // Assert: the wrong literal must not validate as an inflow event.
    expect(result.success).toBe(false);
  });
});
