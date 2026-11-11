import { expect, it } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { shouldReviewOxygenBooking } from './oxygen-booking-review';

it('reviews a booked plan only until its reference has been accepted', () => {
  const snapshot = {
    stage: 'booked',
    state: { booking: { status: 'BOOKED' }, bookingReference: 'plan-1' },
  } as OxygenRuntimeSnapshot;
  expect(shouldReviewOxygenBooking(null)).toBe(false);
  expect(shouldReviewOxygenBooking(snapshot)).toBe(true);
  expect(shouldReviewOxygenBooking(snapshot, 'plan-1')).toBe(false);
});
