import { describe, expect, it } from 'vitest';
import { interestPayoutSuccessEventSchema } from './interest-payout-event';

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

describe('interestPayoutSuccessEventSchema', () => {
  it('accepts the provider-shaped interest payout', () => {
    // Arrange & Act
    const result = interestPayoutSuccessEventSchema.safeParse(interestEvent);

    // Assert
    expect(result.success).toBe(true);
  });

  it('rejects a negative payout amount', () => {
    // Arrange & Act
    const result = interestPayoutSuccessEventSchema.safeParse({
      ...interestEvent,
      eventData: { ...interestEvent.eventData, amount: -95000 },
    });

    // Assert: ledger-bound money must stay nonnegative kobo.
    expect(result.success).toBe(false);
  });
});
