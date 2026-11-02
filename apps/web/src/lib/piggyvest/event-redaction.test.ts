import { describe, expect, it } from 'vitest';
import {
  type PiggyvestWebhookEvent,
  walletTransferOutflowSuccessEventSchema,
} from '@/schemas/piggyvest/events';
import { redactEventDetails } from './event-redaction';

const INFLOW = {
  eventId: 'evt-synthetic-001',
  eventType: 'bank-transfer.inflow.success',
  eventCategory: 'bank-transfer',
  customer_id: 'pvb-customer-synthetic-001',
  eventData: {
    id: 'ed-synthetic-001',
    customer_id: 'pvb-customer-synthetic-001',
    source_wallet_id: 'src-001',
    destination_wallet_id: 'pvb-wallet-synthetic-001',
    type: 'inflow',
    category: 'bank_transfer_inflow',
    amount: 1000000,
    currency: 'NGN',
    narration: 'Transfer from SENDER NAME',
    ip_address: '203.0.113.7',
    transaction_id: 'txn-synthetic-001',
    timestamp: '2026-09-18T17:00:00+01:00',
    status: 'success',
    third_party_reference: 'tpr-001',
    initiator_reference: 'ir-001',
    internal_reference: 'inr-001',
    attempts: 1,
    provider: 'synthetic-bank',
    destination_wallet_balance: 1000000,
    destination_wallet_ledger_balance: 1000000,
    destination_transaction_balance: 1000000,
    reference: 'ref-synthetic-001',
    recipient_bank_account_number: '9000000001',
    recipient_bank_account_name: 'SYNTHETIC PLAN WALLET',
    sender_bank_account_number: '8000000002',
    sender_bank_name: 'Synthetic Sender Bank',
    sender_name: 'SENDER NAME',
    session_id: 'sess-synthetic-001',
    fee: 5000,
  },
  pvb_reference: 'pvb-ref-001',
  pvb_wallet: 'pvb-wallet-synthetic-001',
  pvb_destination_wallet: null,
  pvb_third_party_reference: null,
  pvb_schedule_payment_id: null,
  pvb_destination_account_creation_reference: null,
  pvb_meta: null,
} as unknown as PiggyvestWebhookEvent;

const WALLET_TRANSFER_OUTFLOW = {
  eventId: 'evt-wallet-transfer-synthetic-001',
  eventType: 'wallet-transfer.outflow.success',
  eventCategory: 'wallet_transfer',
  customer_id: 'pvb-customer-synthetic-001',
  pvb_reference: 'pvb-ref-wallet-synthetic-001',
  pvb_wallet: 'pvb-wallet-synthetic-001',
  eventData: {
    transaction_id: 'txn-wallet-transfer-candidate-001',
    amount: 50000,
    currency: 'NGN',
    source_wallet: 'source-wallet-sensitive-001',
    destination_wallet: 'destination-wallet-sensitive-001',
    narration: 'Sensitive transfer narration',
    reference: 'private-reference-001',
    ip_address: '203.0.113.8',
    provider_response: { token: 'provider-token-sensitive' },
  },
} as unknown as PiggyvestWebhookEvent;

describe('redactEventDetails', () => {
  it('keeps reconciliation fields and drops all bank PII from inflows', () => {
    const redacted = redactEventDetails(INFLOW);
    expect(redacted).toMatchObject({
      eventId: 'evt-synthetic-001',
      transaction_id: 'txn-synthetic-001',
      reference: 'ref-synthetic-001',
      session_id: 'sess-synthetic-001',
      amount: 1000000,
      fee: 5000,
      destination_wallet_id: 'pvb-wallet-synthetic-001',
    });
    const serialized = JSON.stringify(redacted);
    for (const pii of [
      '9000000001',
      'SYNTHETIC PLAN WALLET',
      '8000000002',
      'Synthetic Sender Bank',
      'SENDER NAME',
      '203.0.113.7',
      'Transfer from SENDER NAME',
    ]) {
      expect(serialized).not.toContain(pii);
    }
  });

  it('never passes through eventData for unpublished shapes', () => {
    const event = {
      eventId: 'evt-synthetic-002',
      eventType: 'restriction-created.success',
      eventCategory: 'restriction',
      customer_id: 'pvb-customer-synthetic-001',
      eventData: { wallet_id: 'w-1', note: 'account 9000000001' },
      pvb_wallet: 'w-1',
    } as unknown as PiggyvestWebhookEvent;
    const redacted = redactEventDetails(event);
    expect(redacted).toMatchObject({ eventId: 'evt-synthetic-002' });
    expect(JSON.stringify(redacted)).not.toContain('9000000001');
  });

  it('retains only the documented transaction candidate ID for wallet outflow success', () => {
    const parsed = walletTransferOutflowSuccessEventSchema.parse(
      WALLET_TRANSFER_OUTFLOW
    );
    expect(parsed.eventData.transaction_id).toBe(
      'txn-wallet-transfer-candidate-001'
    );

    const redacted = redactEventDetails(parsed);
    expect(redacted).toEqual({
      eventId: 'evt-wallet-transfer-synthetic-001',
      eventType: 'wallet-transfer.outflow.success',
      eventCategory: 'wallet_transfer',
      customer_id: 'pvb-customer-synthetic-001',
      transaction_id: 'txn-wallet-transfer-candidate-001',
    });
    expect(JSON.stringify(redacted)).not.toMatch(
      /50000|NGN|source-wallet-sensitive|destination-wallet-sensitive|Sensitive transfer narration|private-reference|203\.0\.113\.8|provider-token-sensitive/
    );
  });

  it('does not retain a missing or non-string wallet outflow transaction ID', () => {
    for (const transaction_id of [undefined, null, 42, '']) {
      const event = {
        ...WALLET_TRANSFER_OUTFLOW,
        eventData: { ...WALLET_TRANSFER_OUTFLOW.eventData, transaction_id },
      } as unknown as PiggyvestWebhookEvent;
      expect(redactEventDetails(event)).not.toHaveProperty('transaction_id');
    }
  });
});
