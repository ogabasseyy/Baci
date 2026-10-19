import { describe, expect, it } from 'vitest';
import { piggyvestWebhookEventSchema } from './events';
import { interestPayoutSuccessEventSchema } from './interest-payout-event';
import observedInterestPayout from './interest-payout-success.fixture.json';

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
  it('accepts the technical-team payload and preserves its net kobo amount', () => {
    const parsed = interestPayoutSuccessEventSchema.parse(
      observedInterestPayout
    );

    expect(parsed.eventCategory).toBe('interest_payout');
    expect(parsed.eventData.amount).toBe(733);
    expect(parsed.eventData.break_down).toEqual({
      gross_interest_payout: 814,
      withholding_tax: 81,
      net_interest_payout: 733,
    });
    expect(parsed.pvb_destination_wallet).toBeNull();
    expect(parsed.eventData.destination_wallet).toBe(
      'b7ff9afd-bb88-11f1-a539-42010a9c0026'
    );
  });

  it('accepts the provider underscore category through the webhook parser', () => {
    const result = piggyvestWebhookEventSchema.safeParse({
      ...interestEvent,
      eventCategory: 'interest_payout',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eventCategory).toBe('interest_payout');
    }
  });

  it.each([
    'interest_accrued',
    'interest payout',
    'INTEREST_PAYOUT',
  ])('rejects the unrelated payout category %s', (eventCategory) => {
    const result = interestPayoutSuccessEventSchema.safeParse({
      ...interestEvent,
      eventCategory,
    });

    expect(result.success).toBe(false);
  });

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
