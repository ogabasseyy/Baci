import { describe, expect, it } from 'vitest';
import {
  isRepairPickupPaymentReady,
  isRepairPickupQuoteAbovePaidFee,
} from './is-repair-pickup-payment-ready';

describe('isRepairPickupPaymentReady', () => {
  it('allows legacy unpaid pickups with null payment columns', () => {
    expect(
      isRepairPickupPaymentReady({
        pickup_fee: null,
        pickup_payment_reference: null,
        pickup_payment_status: null,
      })
    ).toBe(true);
  });

  it('requires paid/retrying/review when a payment reference exists', () => {
    expect(
      isRepairPickupPaymentReady({
        pickup_fee: null,
        pickup_payment_reference: 'RPU-PENDINGREF12345',
        pickup_payment_status: null,
      })
    ).toBe(false);
  });

  it('blocks newly created pickups marked awaiting_payment', () => {
    expect(
      isRepairPickupPaymentReady({
        pickup_fee: null,
        pickup_payment_reference: null,
        pickup_payment_status: 'awaiting_payment',
      })
    ).toBe(false);
  });

  it('blocks merchant manual fulfillment from GIGL booking', () => {
    expect(
      isRepairPickupPaymentReady({
        pickup_fee: 3500,
        pickup_payment_reference: 'RPU-ABC123DEF45678',
        pickup_payment_status: 'manual_fulfilled',
      })
    ).toBe(false);
  });

  it('allows paid pickups with a positive fee', () => {
    expect(
      isRepairPickupPaymentReady({
        pickup_fee: 3500,
        pickup_payment_reference: 'RPU-ABC123DEF45678',
        pickup_payment_status: 'paid',
      })
    ).toBe(true);
  });
});

describe('isRepairPickupQuoteAbovePaidFee', () => {
  it('skips comparison when no positive paid fee exists', () => {
    expect(isRepairPickupQuoteAbovePaidFee(3600, null)).toBe(false);
  });

  it('flags a live quote above the paid fee', () => {
    expect(isRepairPickupQuoteAbovePaidFee(3600, 3500)).toBe(true);
  });
});
