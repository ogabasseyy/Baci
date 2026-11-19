import { expect, it } from 'vitest';
import { oxygenApprovalWindowUsable } from './oxygen-approval-window-usable';

it('only admits an unexpired window for the same booking', () => {
  const window = {
    bookingReference: 'booking-a',
    sentAt: '2026-11-03T12:00:00Z',
    expiresAt: '2026-11-03T12:05:00Z',
  };
  const now = Date.parse('2026-11-03T12:04:59Z');
  expect(oxygenApprovalWindowUsable(window, 'booking-a', now)).toBe(true);
  expect(oxygenApprovalWindowUsable(window, 'booking-b', now)).toBe(false);
  expect(
    oxygenApprovalWindowUsable(
      window,
      'booking-a',
      Date.parse(window.expiresAt)
    )
  ).toBe(false);
  expect(oxygenApprovalWindowUsable(null, 'booking-a', now)).toBe(false);
});
