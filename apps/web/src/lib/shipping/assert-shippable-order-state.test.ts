import { describe, expect, it } from 'vitest';
import { assertShippableOrderState } from './assert-shippable-order-state';
import { OrderShipmentBookingError } from './order-shipment-booking-error';

describe('assertShippableOrderState', () => {
  it('accepts a paid order with items', () => {
    expect(() =>
      assertShippableOrderState({ items: [{}], paymentStatus: 'paid' })
    ).not.toThrow();
  });

  it('rejects an order with no items', () => {
    try {
      assertShippableOrderState({ items: [], paymentStatus: 'paid' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(OrderShipmentBookingError);
      expect((error as OrderShipmentBookingError).code).toBe(
        'MISSING_ORDER_ITEMS'
      );
    }
  });

  it('rejects a fully-refunded order before provider booking', () => {
    try {
      assertShippableOrderState({ items: [{}], paymentStatus: 'refunded' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(OrderShipmentBookingError);
      expect((error as OrderShipmentBookingError).code).toBe('ORDER_REFUNDED');
      expect((error as Error).message).toContain('can no longer be shipped');
    }
  });

  it('matches refunded status case-insensitively', () => {
    expect(() =>
      assertShippableOrderState({ items: [{}], paymentStatus: ' Refunded ' })
    ).toThrowError(OrderShipmentBookingError);
  });
});
