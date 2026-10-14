import { describe, expect, it } from 'vitest';
import {
  CANCELLED_STATUS_SPELLINGS,
  evaluateOrderCancelledTransition,
} from './evaluate-order-cancelled-transition';

describe('evaluateOrderCancelledTransition', () => {
  it('rejects moving a payment-cancelled order to any other payment status', () => {
    expect(
      evaluateOrderCancelledTransition({
        existingPaymentStatus: 'cancelled',
        existingShippingStatus: 'pending',
        requestedPaymentStatus: 'paid',
        requestedShippingStatus: undefined,
      })?.code
    ).toBe('PAYMENT_CANCELLED_TERMINAL');
    expect(
      evaluateOrderCancelledTransition({
        existingPaymentStatus: 'canceled',
        existingShippingStatus: 'pending',
        requestedPaymentStatus: 'pending',
        requestedShippingStatus: undefined,
      })?.code
    ).toBe('PAYMENT_CANCELLED_TERMINAL');
  });

  it('rejects moving a shipping-cancelled order out of cancelled', () => {
    expect(
      evaluateOrderCancelledTransition({
        existingPaymentStatus: 'paid',
        existingShippingStatus: 'cancelled',
        requestedPaymentStatus: undefined,
        requestedShippingStatus: 'pending',
      })?.code
    ).toBe('SHIPPING_CANCELLED_TERMINAL');
  });

  it('allows same-value and unrelated-field patches on cancelled orders', () => {
    expect(
      evaluateOrderCancelledTransition({
        existingPaymentStatus: 'cancelled',
        existingShippingStatus: 'cancelled',
        requestedPaymentStatus: 'cancelled',
        requestedShippingStatus: undefined,
      })
    ).toBeNull();
    expect(
      evaluateOrderCancelledTransition({
        existingPaymentStatus: 'cancelled',
        existingShippingStatus: 'pending',
        requestedPaymentStatus: undefined,
        requestedShippingStatus: undefined,
      })
    ).toBeNull();
  });

  it('allows transitions on orders that were never cancelled', () => {
    expect(
      evaluateOrderCancelledTransition({
        existingPaymentStatus: 'pending',
        existingShippingStatus: 'pending',
        requestedPaymentStatus: 'paid',
        requestedShippingStatus: 'processing',
      })
    ).toBeNull();
  });
});

describe('CANCELLED_STATUS_SPELLINGS', () => {
  it('covers both cancelled spellings on both status axes', () => {
    expect(CANCELLED_STATUS_SPELLINGS).toEqual([
      ['payment_status', 'cancelled'],
      ['payment_status', 'canceled'],
      ['shipping_status', 'cancelled'],
      ['shipping_status', 'canceled'],
    ]);
  });
});
