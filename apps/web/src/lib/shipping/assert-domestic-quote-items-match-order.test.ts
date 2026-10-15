import { describe, expect, it } from 'vitest';
import { assertDomesticQuoteItemsMatchOrder } from './assert-domestic-quote-items-match-order';
import type { QuoteRequest, ShipmentItem } from './types';

const order = [
  {
    name: 'Phone',
    quantity: 2,
    price: 1000,
    fulfillment_data: { fulfillmentQuantity: 1 },
    product: {
      weight_value: 1,
      weight_unit: 'kg',
      dimensions: { length: 10, width: 5, height: 3 },
    },
  },
  {
    name: 'Case',
    quantity: 1,
    price: 100,
    fulfillment_data: { fulfillmentQuantity: 0 },
  },
];
const phone = {
  name: 'Phone',
  quantity: 2,
  value: 1000,
  weight: 1,
  length: 10,
  width: 5,
  height: 3,
};
const caseItem = { name: 'Case', quantity: 1, value: 100, weight: 1 };
function request(items: ShipmentItem[]): QuoteRequest {
  return {
    sessionId: 'order',
    shipmentType: 'domestic',
    receiver: {
      name: 'Buyer',
      phone: '08012345678',
      address: 'Street',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
      countryCode: 'NG',
    },
    items,
  };
}

describe('assertDomesticQuoteItemsMatchOrder', () => {
  it.each([
    [phone, caseItem],
    [{ ...phone, quantity: 1 }],
  ])('accepts a complete snapshot: %j', (...items) => {
    expect(() =>
      assertDomesticQuoteItemsMatchOrder(request(items), order, 1)
    ).not.toThrow();
  });
  it.each([
    [{ ...phone, quantity: 1 }, caseItem],
    [{ ...phone, name: 'Other' }, caseItem],
    [{ ...phone, weight: 2 }, caseItem],
    [{ ...phone, value: 999 }, caseItem],
    [{ ...phone, width: 6 }, caseItem],
    [phone, caseItem, caseItem],
  ])('rejects mixed, substituted or duplicated contents: %j', (...items) => {
    expect(() =>
      assertDomesticQuoteItemsMatchOrder(request(items), order, 1)
    ).toThrow('no longer matches');
  });
});
