import { describe, expect, it, vi } from 'vitest';
import { preparePrimaryWalletInflowReceipt } from './primary-wallet-inflow-receipt';

vi.mock('server-only', () => ({}));
const event = {
  eventId: 'test-event',
  eventType: 'bank-transfer.inflow.success',
  eventCategory: 'inflow_transaction',
  customer_id: 'test-customer',
  pvb_reference: 'test-provider-reference',
  pvb_wallet: 'test-primary-wallet',
  eventData: {
    id: 'test-data-id',
    customer_id: 'test-customer',
    destination_wallet_id: 'test-conduit-wallet',
    type: 'inter',
    category: 'bank_transfer_inflow',
    amount: 10000,
    currency: 'NGN',
    narration: 'Private sender',
    ip_address: '',
    transaction_id: 'test-transaction',
    timestamp: '2026-10-07T10:00:00.000Z',
    status: 'COMPLETED',
    third_party_reference: '',
    initiator_reference: '',
    internal_reference: '',
    provider: 'test-bank',
    destination_wallet_balance: 10000,
    destination_wallet_ledger_balance: 10000,
    destination_transaction_balance: 10000,
    reference: 'test-reference',
    recipient_bank_account_number: '0123456789',
    sender_name: 'Private sender',
    fee: 100,
  },
};

describe('primary wallet inflow receipt preparation', () => {
  it('uses the attributed wallet rather than a conduit and excludes sender details', () => {
    const receipt = preparePrimaryWalletInflowReceipt(event);
    expect(receipt.providerWalletId).toBe('test-primary-wallet');
    expect(receipt.amountKobo).toBe(10000);
    expect(receipt.feeKobo).toBe(100);
    expect(JSON.stringify(receipt)).not.toContain('Private sender');
    expect(JSON.stringify(receipt)).not.toContain('0123456789');
  });
  it('uses identical financial identity for redeliveries under new event IDs', () => {
    expect(
      preparePrimaryWalletInflowReceipt({ ...event, eventId: 'redelivery' })
        .financialFingerprint
    ).toBe(preparePrimaryWalletInflowReceipt(event).financialFingerprint);
    expect(
      preparePrimaryWalletInflowReceipt({
        ...event,
        eventData: { ...event.eventData, amount: 20000 },
      }).financialFingerprint
    ).not.toBe(preparePrimaryWalletInflowReceipt(event).financialFingerprint);
  });
  it('rejects contradictory customer identities and invalid money', () => {
    for (const eventData of [
      { ...event.eventData, customer_id: 'another' },
      { ...event.eventData, amount: 0 },
      { ...event.eventData, amount: 1.5 },
    ]) {
      expect(() =>
        preparePrimaryWalletInflowReceipt({ ...event, eventData })
      ).toThrow('Invalid wallet inflow receipt');
    }
  });
});
