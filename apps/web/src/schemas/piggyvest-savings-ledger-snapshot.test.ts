import { describe, expect, it } from 'vitest';
import { piggyvestSavingsLedgerSnapshotSchema } from './piggyvest-savings-ledger-snapshot';

const snapshot = {
  ledger: {
    confirmedPrincipalKobo: 100,
    reservedPrincipalKobo: 80,
    paidEligibleInterestKobo: 10,
    reservedPaidInterestKobo: 0,
    pendingInterestKobo: 900,
  },
  activeReservation: {
    operationId: '11111111-1111-4111-8111-111111111111',
    kind: 'reserve_refund',
    principalKobo: 80,
    interestKobo: 0,
  },
  fundingReversed: false,
};

describe('ledger snapshot', () => {
  it('preserves pending interest separately from spendable totals', () => {
    expect(piggyvestSavingsLedgerSnapshotSchema.parse(snapshot)).toEqual(
      snapshot
    );
  });
  it('rejects reservations without matching identity and amounts', () => {
    expect(
      piggyvestSavingsLedgerSnapshotSchema.safeParse({
        ...snapshot,
        activeReservation: null,
      }).success
    ).toBe(false);
    expect(
      piggyvestSavingsLedgerSnapshotSchema.safeParse({
        ...snapshot,
        ledger: { ...snapshot.ledger, reservedPrincipalKobo: 101 },
      }).success
    ).toBe(false);
  });
});
