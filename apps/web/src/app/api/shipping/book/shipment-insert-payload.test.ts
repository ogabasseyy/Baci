import { describe, expect, it } from 'vitest';
import { buildShipmentInsertPayload } from './shipment-insert-payload';

describe('buildShipmentInsertPayload', () => {
  it('persists provider booking metadata for station pickup shipments', () => {
    const payload = buildShipmentInsertPayload({
      orderId: 'order-1',
      merchantId: 'merchant-1',
      senderInfo: {
        name: 'Merchant',
        phone: '08000000000',
        address: '1 Merchant Road',
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
        countryCode: 'NG',
      },
      receiver: {
        name: 'Customer',
        phone: '08000000001',
        address: '2 Customer Road',
        city: 'Port Harcourt',
        state: 'Rivers',
        country: 'Nigeria',
        countryCode: 'NG',
      },
      items: [{ name: 'Phone', quantity: 1, weight: 1, value: 100000 }],
      quote: {
        id: 'quote-1',
        price: 4500,
        currency: 'NGN',
        estimated_days: 2,
      },
      result: {
        provider: 'GIGL',
        providerShipmentId: 'GIGL-WB-1',
        trackingNumber: 'GIGL-WB-1',
        carrierName: 'GIG Logistics',
        status: 'booked',
        isStationPickup: true,
        pickupStationName: 'PORT HARCOURT',
        pickupStationAddress: 'Port Harcourt station',
        pickupScheduledAt: new Date('2026-06-30T12:00:00.000Z'),
        rawResponse: { Waybill: 'GIGL-WB-1' },
      },
    });

    expect(payload).toMatchObject({
      order_id: 'order-1',
      merchant_id: 'merchant-1',
      provider: 'GIGL',
      shipping_quote_id: 'quote-1',
      is_station_pickup: true,
      station_name: 'PORT HARCOURT',
      station_address: 'Port Harcourt station',
      price: 4500,
      currency: 'NGN',
      estimated_delivery_days: 2,
      pickup_scheduled_at: '2026-06-30T12:00:00.000Z',
    });
  });
});
