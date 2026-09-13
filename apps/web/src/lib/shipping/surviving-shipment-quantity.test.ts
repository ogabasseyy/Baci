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

  it('preserves zero when all surviving units were refunded', () => {
    expect(
      survivingShipmentQuantity({
        quantity: 2,
        fulfillment_data: { fulfillmentQuantity: 0 },
      })
    ).toBe(0);
  });
});
