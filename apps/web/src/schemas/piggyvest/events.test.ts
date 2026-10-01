import { describe, expect, it } from 'vitest';
import {
  bankTransferInflowSuccessEventSchema,
  interestPayoutSuccessEventSchema,
  piggyvestWebhookEventSchema,
} from './events';

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

const interestEvent = {
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
};

describe('bankTransferInflowSuccessEventSchema', () => {
  it('accepts the provider-shaped inflow payload with synthetic identifiers', () => {
    const parsed = bankTransferInflowSuccessEventSchema.parse(inflowEvent);
    expect(parsed.eventData.amount).toBe(1750000);
    expect(parsed.eventData.currency).toBe('NGN');
  });

  it('rejects fractional kobo amounts', () => {
    const bad = {
      ...inflowEvent,
      eventData: { ...inflowEvent.eventData, amount: 1750000.5 },
    };
    expect(() => bankTransferInflowSuccessEventSchema.parse(bad)).toThrow();
  });

  it('rejects negative amounts', () => {
    const bad = {
      ...inflowEvent,
      eventData: { ...inflowEvent.eventData, amount: -100 },
    };
    expect(() => bankTransferInflowSuccessEventSchema.parse(bad)).toThrow();
  });

  it('rejects non-NGN currency', () => {
    const bad = {
      ...inflowEvent,
      eventData: { ...inflowEvent.eventData, currency: 'USD' },
    };
    expect(() => bankTransferInflowSuccessEventSchema.parse(bad)).toThrow();
  });
});

describe('interestPayoutSuccessEventSchema', () => {
  it('accepts the provider-shaped interest payout with synthetic identifiers', () => {
    const parsed = interestPayoutSuccessEventSchema.parse(interestEvent);
    expect(parsed.eventData.break_down.net_interest_payout).toBe(95000);
  });

  it('exposes gross/net/withholding-tax breakdown for ledger attribution', () => {
    const parsed = interestPayoutSuccessEventSchema.parse(interestEvent);
    const { gross_interest_payout, withholding_tax, net_interest_payout } =
      parsed.eventData.break_down;
    expect(gross_interest_payout - withholding_tax).toBe(net_interest_payout);
  });

  it('rejects mismatched event type', () => {
    const bad = { ...interestEvent, eventType: 'interest-payout.failed' };
    expect(() => interestPayoutSuccessEventSchema.parse(bad)).toThrow();
  });
});

describe('piggyvestWebhookEventSchema', () => {
  it('routes both supported event types through the discriminated union', () => {
    expect(piggyvestWebhookEventSchema.parse(inflowEvent).eventType).toBe(
      'bank-transfer.inflow.success'
    );
    expect(piggyvestWebhookEventSchema.parse(interestEvent).eventType).toBe(
      'interest-payout.success'
    );
  });

  it('rejects unknown event types without financial acceptance', () => {
    const bad = { ...inflowEvent, eventType: 'wallet.transfer.success' };
    expect(() => piggyvestWebhookEventSchema.parse(bad)).toThrow();
  });
});
