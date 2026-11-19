import { expect, it } from 'vitest';
import { oxygenBookedSnapshot } from './oxygen-booked-snapshot.test-support';
import { shouldReviewOxygenBooking } from './oxygen-booking-review';

it('reviews a booked plan only until its reference has been accepted', () => {
  const snapshot = oxygenBookedSnapshot;
  expect(shouldReviewOxygenBooking(null)).toBe(false);
  expect(shouldReviewOxygenBooking(snapshot)).toBe(true);
  expect(
    shouldReviewOxygenBooking(snapshot, snapshot.state.bookingReference)
  ).toBe(false);
});
