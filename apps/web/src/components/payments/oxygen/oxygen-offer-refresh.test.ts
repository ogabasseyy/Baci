import { expect, it } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import {
  canRefreshSavedOxygenOffers,
  shouldReviewOxygenBooking,
} from './oxygen-offer-refresh';

it('only allows refresh for an unapproved saved booking with no active command', () => {
  const snapshot = {
    stage: 'booked',
    state: { booking: { status: 'BOOKED' } },
  } as OxygenRuntimeSnapshot;
  expect(canRefreshSavedOxygenOffers(snapshot)).toBe(true);
  expect(
    canRefreshSavedOxygenOffers({
      ...snapshot,
      pending: { action: 'book', status: 'queued', idempotencyKey: 'x' },
    } as OxygenRuntimeSnapshot)
  ).toBe(false);
  expect(
    canRefreshSavedOxygenOffers({
      ...snapshot,
      state: { ...snapshot.state, offers: [{ tenure: 3, loanAmount: 1 }] },
    })
  ).toBe(false);
  expect(
    canRefreshSavedOxygenOffers({
      ...snapshot,
      state: { ...snapshot.state, paymentComplete: true },
    })
  ).toBe(false);
  expect(shouldReviewOxygenBooking(null)).toBe(false);
});
