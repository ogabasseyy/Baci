import { describe, expect, it } from 'vitest';
import {
  bankTransferInflowSuccessEventSchema,
  bankTransferOutflowFailedEventSchema,
  bankTransferOutflowSuccessEventSchema,
  createWalletSuccessEventSchema,
  interestPayoutSuccessEventSchema,
  piggyvestWebhookEventSchema,
  reserveVirtualAccountSuccessEventSchema,
  restrictionCreatedSuccessEventSchema,
  restrictionLiftedSuccessEventSchema,
  walletTransferOutflowSuccessEventSchema,
} from './events';
import observedInterestPayout from './interest-payout-success.fixture.json';

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
  it.each([
    undefined,
    null,
  ])('preserves an absent or nullable session: %s', (session_id) => {
    const parsed = bankTransferInflowSuccessEventSchema.parse({
      ...inflowEvent,
      eventData: { ...inflowEvent.eventData, session_id },
    });
    expect(parsed.eventData.session_id).toBe(session_id);
  });

  it.each([
    '',
    123,
    false,
  ])('rejects malformed non-null sessions: %s', (session_id) => {
    expect(
      bankTransferInflowSuccessEventSchema.safeParse({
        ...inflowEvent,
        eventData: { ...inflowEvent.eventData, session_id },
      }).success
    ).toBe(false);
  });

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

  it('accepts the genuine observed shape (18 Sep 2026 staging event)', () => {
    // Mirrors the real bank-transfer.inflow.success delivery observed on
    // staging (eventId 01M2TTNT0N08C81J5BEADH3BY8): category
    // "inflow_transaction", type "inter", status "COMPLETED", null senders,
    // absent session/attempts/source-wallet fields, absent nullable
    // envelope keys, and a destination_wallet_id that differs from
    // pvb_wallet. PII below is synthetic.
    const observed = {
      eventId: 'evt-observed-inflow-001',
      eventType: 'bank-transfer.inflow.success',
      eventCategory: 'inflow_transaction',
      customer_id: 'pvb-customer-observed-001',
      eventData: {
        id: 'ed-observed-001',
        customer_id: 'pvb-customer-observed-001',
        destination_wallet_id: 'pvb-conduit-observed-001',
        type: 'inter',
        category: 'bank_transfer_inflow',
        amount: 10000,
        currency: 'NGN',
        narration: 'Wallet Funding',
        ip_address: '127.0.0.1',
        transaction_id: 'txn-observed-001',
        timestamp: '2026-09-18T17:57:47.566Z',
        internal_reference: 'inr-observed-001',
        third_party_reference: 'inr-observed-001',
        initiator_reference: 'inr-observed-001',
        status: 'COMPLETED',
        provider: 'FAAS',
        lock_funds_id: null,
        recipient_name: null,
        recipient_bank_account_number: '9000000001',
        recipient_bank_account_name: 'SYNTHETIC PLAN WALLET',
        sender_bank_account_number: null,
        sender_bank_name: null,
        sender_name: null,
        fee: 0,
        provider_fee: null,
        batch_id: null,
        destination_wallet_balance: 10000,
        destination_wallet_ledger_balance: 10000,
        destination_transaction_balance: 10000,
        reference: 'ref-observed-001',
      },
      pvb_reference: 'pvb-ref-observed-001',
      pvb_wallet: 'pvb-wallet-observed-001',
    };
    const parsed = bankTransferInflowSuccessEventSchema.parse(observed);
    expect(parsed.eventData.transaction_id).toBe('txn-observed-001');
    expect(parsed.eventData.amount).toBe(10000);
  });
});

describe('interestPayoutSuccessEventSchema', () => {
  it('accepts the technical-team payout with an underscored category', () => {
    const parsed = piggyvestWebhookEventSchema.parse(observedInterestPayout);
    expect(parsed.eventCategory).toBe('interest_payout');
  });

  it('rejects an unrecognised interest payout category', () => {
    expect(
      interestPayoutSuccessEventSchema.safeParse({
        ...observedInterestPayout,
        eventCategory: 'interest_accrued',
      }).success
    ).toBe(false);
  });

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

describe('createWalletSuccessEventSchema', () => {
  it('accepts the official docs-shaped wallet creation with synthetic identifiers', () => {
    const parsed = createWalletSuccessEventSchema.parse({
      eventId: '4204dc18-efb3-44d0-b9a2-1362448d4f21',
      customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
      eventType: 'create-wallet.success',
      eventCategory: 'create_wallet',
      eventData: { wallet_status: 'processing' },
      pvb_wallet: '923f843a-be7e-494a-bc5d-9f49f4cc640f',
    });
    expect(parsed.pvb_wallet).toBe('923f843a-be7e-494a-bc5d-9f49f4cc640f');
  });

  it('rejects mismatched category', () => {
    const bad = {
      eventId: '4204dc18-efb3-44d0-b9a2-1362448d4f21',
      customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
      eventType: 'create-wallet.success',
      eventCategory: 'bank-transfer',
      eventData: {},
      pvb_wallet: '923f843a-be7e-494a-bc5d-9f49f4cc640f',
    };
    expect(() => createWalletSuccessEventSchema.parse(bad)).toThrow();
  });
});

describe.each([
  ['reserve_virtual_account.success', reserveVirtualAccountSuccessEventSchema],
  ['bank-transfer.outflow.success', bankTransferOutflowSuccessEventSchema],
  ['bank-transfer.outflow.failed', bankTransferOutflowFailedEventSchema],
  ['wallet-transfer.outflow.success', walletTransferOutflowSuccessEventSchema],
  ['restriction-created.success', restrictionCreatedSuccessEventSchema],
  ['restriction-lifted.success', restrictionLiftedSuccessEventSchema],
] as const)('%s', (eventType, schema) => {
  it('routes the officially listed event through the union', () => {
    const event = {
      eventId: '4204dc18-efb3-44d0-b9a2-1362448d4f21',
      customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
      eventType,
      eventCategory: 'unpublished-category',
      eventData: { provider_status: 'synthetic' },
    };
    expect(schema.parse(event).eventType).toBe(eventType);
    expect(piggyvestWebhookEventSchema.parse(event).eventType).toBe(eventType);
  });
});

describe('piggyvestWebhookEventSchema', () => {
  it('routes all supported event types through the discriminated union', () => {
    expect(piggyvestWebhookEventSchema.parse(inflowEvent).eventType).toBe(
      'bank-transfer.inflow.success'
    );
    expect(piggyvestWebhookEventSchema.parse(interestEvent).eventType).toBe(
      'interest-payout.success'
    );
    expect(
      piggyvestWebhookEventSchema.parse({
        eventId: '4204dc18-efb3-44d0-b9a2-1362448d4f21',
        customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
        eventType: 'create-wallet.success',
        eventCategory: 'create_wallet',
        eventData: {},
        pvb_wallet: '923f843a-be7e-494a-bc5d-9f49f4cc640f',
      }).eventType
    ).toBe('create-wallet.success');
  });

  it('rejects unknown event types without financial acceptance', () => {
    const bad = { ...inflowEvent, eventType: 'wallet.transfer.success' };
    expect(() => piggyvestWebhookEventSchema.parse(bad)).toThrow();
  });
});
