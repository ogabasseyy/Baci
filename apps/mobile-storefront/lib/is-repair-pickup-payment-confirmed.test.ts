import { isRepairPickupPaymentConfirmed } from './is-repair-pickup-payment-confirmed';

describe('isRepairPickupPaymentConfirmed', () => {
  it.each([
    'paid',
    'booked',
    'review',
    'manual_fulfilled',
  ])('accepts %s', (status) => {
    expect(isRepairPickupPaymentConfirmed(status)).toBe(true);
  });
  it.each([
    undefined,
    'pending',
    'awaiting_payment',
    'unknown',
    'failed',
  ])('rejects %s', (status) => {
    expect(isRepairPickupPaymentConfirmed(status)).toBe(false);
  });
});
