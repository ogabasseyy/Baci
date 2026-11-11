import { expect, it } from 'vitest';
import { oxygenBookedSnapshot } from './oxygen-booked-snapshot.test-support';
import { canRefreshSavedOxygenOffers } from './oxygen-offer-refresh';

it('only allows refresh for an unapproved saved booking with no active command', () => {
  const snapshot = oxygenBookedSnapshot;
  expect(canRefreshSavedOxygenOffers(snapshot)).toBe(true);
  expect(
    canRefreshSavedOxygenOffers({
      ...snapshot,
      pending: {
        action: 'book',
        status: 'queued',
        idempotencyKey: '80000000-0000-4000-8000-000000000001',
      },
    })
  ).toBe(false);
  expect(
    canRefreshSavedOxygenOffers({
      ...snapshot,
      state: {
        ...snapshot.state,
        eligibleAmount: 100000,
        minimumAmount: 10000,
        maxTenure: 3,
        offers: [{ tenure: 3, loanAmount: 100000 }],
      },
    })
  ).toBe(false);
  expect(
    canRefreshSavedOxygenOffers({
      ...snapshot,
      state: {
        ...snapshot.state,
        eligibleAmount: 100000,
        minimumAmount: 10000,
        maxTenure: 3,
        offers: [{ tenure: 3, loanAmount: 50000 }],
      },
    })
  ).toBe(true);
  expect(
    canRefreshSavedOxygenOffers({
      ...snapshot,
      state: { ...snapshot.state, paymentComplete: true },
    })
  ).toBe(false);
});
