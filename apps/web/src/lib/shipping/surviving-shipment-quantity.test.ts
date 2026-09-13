import { describe, expect, it } from 'vitest';
import { survivingShipmentQuantity } from './surviving-shipment-quantity';

describe('survivingShipmentQuantity', () => {
  it('uses the persisted quantity after a partial REDVAULT refund', () => {
    expect(
      survivingShipmentQuantity({
        quantity: 2,
        fulfillment_data: { fulfillmentQuantity: 1 },
      })
    ).toBe(1);
  });

  it('falls back to the order quantity for invalid persisted data', () => {
    expect(
      survivingShipmentQuantity({
        quantity: 2,
        fulfillment_data: { fulfillmentQuantity: 0 },
      })
    ).toBe(2);
  });
});
