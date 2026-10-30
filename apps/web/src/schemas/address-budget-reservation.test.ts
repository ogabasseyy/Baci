import { expect, it } from 'vitest';
import { addressBudgetReservationSchema } from './address-budget-reservation';

it('requires a bounded pacing delay and a reservation identity for admission', () => {
  expect(
    addressBudgetReservationSchema.safeParse({
      status: 'reserved',
      reservationId: '00000000-0000-4000-8000-000000000001',
      dispatchBefore: 1793350000000,
    }).success
  ).toBe(true);
  for (const status of ['unavailable', 'limit_reached', 'duplicate'])
    expect(addressBudgetReservationSchema.safeParse({ status }).success).toBe(
      true
    );
  expect(
    addressBudgetReservationSchema.safeParse({
      status: 'paced',
      retryAfterMs: 250,
    }).success
  ).toBe(true);
  for (const data of [
    { status: 'reserved' },
    { status: 'unknown' },
    { status: 'paced', retryAfterMs: 0 },
    { status: 'paced', retryAfterMs: 251 },
  ]) {
    expect(addressBudgetReservationSchema.safeParse(data).success).toBe(false);
  }
});
