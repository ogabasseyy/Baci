import { describe, expect, it } from 'vitest';
import {
  assertShippableBookingItems,
  type OrderItemRecord,
  toDomesticBookingItems,
} from './order-shipment-booking-utils';
import type { ShipmentItem } from './types';

const remaining: OrderItemRecord = {
  name: 'Phone',
  quantity: 2,
  price: 1000,
  fulfillment_data: { fulfillmentQuantity: 1 },
};
const refunded: OrderItemRecord = {
  name: 'Phone',
  quantity: 1,
  price: 1000,
  fulfillment_data: { fulfillmentQuantity: 0 },
};
const recovered: ShipmentItem = {
  name: 'Phone',
  quantity: 1,
  weight: 2,
  value: 1000,
  length: 10,
  width: 5,
  height: 3,
};

describe('domestic booking after recovery quotes surviving quantities', () => {
  it.each([
    [remaining, refunded],
    [refunded, remaining],
  ])('keeps the surviving item despite a same-name/price original-quantity collision: %j', (...orderItems) => {
    const items = toDomesticBookingItems(orderItems, [recovered]);
    expect(items).toEqual([{ ...recovered, description: 'Phone' }]);
    expect(() => assertShippableBookingItems(items)).not.toThrow();
  });

  it('matches multiple surviving rows once each despite refunded quantity collisions', () => {
    const anotherRemaining = {
      ...remaining,
      quantity: 3,
      fulfillment_data: { fulfillmentQuantity: 1 },
    };
    expect(
      toDomesticBookingItems(
        [refunded, remaining, anotherRemaining],
        [recovered, { ...recovered, weight: 3 }]
      ).map(({ quantity, weight }) => ({ quantity, weight }))
    ).toEqual([
      { quantity: 1, weight: 2 },
      { quantity: 1, weight: 3 },
    ]);
  });

  it('still reduces legacy original-quantity quotes and removes fully refunded rows', () => {
    expect(
      toDomesticBookingItems(
        [remaining, refunded],
        [{ ...recovered, quantity: 2 }, recovered]
      )
    ).toEqual([{ ...recovered, description: 'Phone' }]);
  });

  it('does not mix surviving and original matching for legacy duplicate rows', () => {
    const unrefunded = { ...refunded, fulfillment_data: undefined };
    expect(
      toDomesticBookingItems(
        [remaining, unrefunded],
        [recovered, { ...recovered, quantity: 2, weight: 3 }]
      ).map(({ quantity, weight }) => ({ quantity, weight }))
    ).toEqual([
      { quantity: 1, weight: 2 },
      { quantity: 1, weight: 3 },
    ]);
  });

  it('still fails closed when a legacy quote contains only fully refunded units', () => {
    const items = toDomesticBookingItems([refunded], [recovered]);
    expect(items).toEqual([]);
    expect(() => assertShippableBookingItems(items)).toThrow(
      'All order items have been refunded'
    );
  });
});
