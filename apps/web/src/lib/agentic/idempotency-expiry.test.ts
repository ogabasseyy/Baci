import { expect, it } from 'vitest';
import { isStaleInProgressReservation } from './idempotency-expiry';

const now = new Date('2026-10-14T10:02:00Z');
it('reclaims only reservations at least two minutes old', () => {
  expect(
    isStaleInProgressReservation({ updated_at: '2026-10-14T10:00:00Z' }, now)
  ).toBe(true);
  expect(
    isStaleInProgressReservation(
      { updated_at: '2026-10-14T10:00:00.001Z' },
      now
    )
  ).toBe(false);
  expect(
    isStaleInProgressReservation({ updated_at: '2026-10-14T10:03:00Z' }, now)
  ).toBe(false);
});
it('does not reclaim missing or invalid timestamps', () => {
  for (const updated_at of [undefined, null, 100, 'invalid'])
    expect(isStaleInProgressReservation({ updated_at }, now)).toBe(false);
});
