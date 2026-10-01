import { describe, expect, it, vi } from 'vitest';
import type { OrderShipmentBookingError } from '@/lib/shipping/order-shipment-booking-utils';
import { findReusableOrderShipment } from './find-reusable-order-shipment';

describe('findReusableOrderShipment', () => {
  it('maps a complete existing shipment for idempotent booking recovery', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'shipment-1',
            provider: 'GIGL',
            provider_shipment_id: 'waybill-1',
            shipping_quote_id: 'quote-refreshed',
            tracking_number: 'waybill-1',
            carrier_name: 'GIG Logistics',
            estimated_delivery_days: 3,
            label_url: 'https://example.com/label.pdf',
            pickup_scheduled_at: '2026-08-25T10:00:00.000Z',
            status: 'booked',
          },
          error: null,
        }),
      }),
    };

    await expect(
      findReusableOrderShipment(supabase as never, 'merchant-1', 'order-1')
    ).resolves.toEqual({
      shipmentId: 'shipment-1',
      provider: 'GIGL',
      providerShipmentId: 'waybill-1',
      trackingNumber: 'waybill-1',
      carrierName: 'GIG Logistics',
      quoteId: 'quote-refreshed',
      estimatedDays: 3,
      labelUrl: 'https://example.com/label.pdf',
      pickupScheduledAt: new Date('2026-08-25T10:00:00.000Z'),
      shipmentStatus: 'booked',
    });
  });

  it('returns null when no reusable shipment exists', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    };

    await expect(
      findReusableOrderShipment(supabase as never, 'merchant-1', 'order-1')
    ).resolves.toBeNull();
  });

  it('throws when an existing shipment is missing booking details', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'shipment-1',
            provider: 'GIGL',
            provider_shipment_id: null,
            tracking_number: null,
            carrier_name: null,
            estimated_delivery_days: 3,
            label_url: null,
            pickup_scheduled_at: null,
            status: 'booked',
          },
          error: null,
        }),
      }),
    };

    await expect(
      findReusableOrderShipment(supabase as never, 'merchant-1', 'order-1')
    ).rejects.toMatchObject({
      code: 'INCOMPLETE_EXISTING_SHIPMENT',
    } satisfies Partial<OrderShipmentBookingError>);
  });
});
