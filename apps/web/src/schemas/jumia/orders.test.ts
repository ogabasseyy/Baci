import { describe, expect, it } from 'vitest';
import { JumiaShipmentProvidersResponseSchema } from './orders';

describe('shipment provider v7 contract', () => {
  it('uses trackingCodeRequired', () => {
    const result = JumiaShipmentProvidersResponseSchema.safeParse({
      orderItems: [
        {
          id: 'ITEM-1',
          shipmentProviders: [
            { id: 'SP-1', name: 'DHL', trackingCodeRequired: true },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
  it('rejects legacy requireTrackingCode', () => {
    const result = JumiaShipmentProvidersResponseSchema.safeParse({
      orderItems: [
        {
          id: 'ITEM-1',
          shipmentProviders: [
            { id: 'SP-1', name: 'DHL', requireTrackingCode: true },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
