import { describe, expect, it } from 'vitest';
import { bookingSuccessResponse } from './booking-success-response';

describe('bookingSuccessResponse', () => {
  it('returns the provider shipment details with a created status', async () => {
    const response = bookingSuccessResponse('shipment-1', {
      trackingNumber: 'TRK-1',
      providerShipmentId: 'provider-1',
      carrierName: 'GIG Logistics',
      status: 'booked',
      pickupScheduledAt: new Date('2026-09-02T10:00:00.000Z'),
      labelUrl: 'https://example.com/label.pdf',
      provider: 'GIGL',
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      success: true,
      shipment: {
        id: 'shipment-1',
        trackingNumber: 'TRK-1',
        providerShipmentId: 'provider-1',
        carrier: 'GIG Logistics',
        status: 'booked',
        pickupScheduledAt: '2026-09-02T10:00:00.000Z',
        labelUrl: 'https://example.com/label.pdf',
      },
    });
  });
});
