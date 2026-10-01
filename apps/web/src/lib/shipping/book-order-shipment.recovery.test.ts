import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/shipping', () => ({
  shippingService: { bookShipment: vi.fn() },
}));

const { bookOrderShipment } = await import('./book-order-shipment');
const { shippingService } = await import('@/lib/shipping');

describe('bookOrderShipment recovery', () => {
  it('returns the refreshed quote id saved with an existing shipment', async () => {
    const orderQuery = {
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'order-1',
          selected_quote_id: 'quote-stale',
        },
        error: null,
      }),
    };
    const shipmentQuery = {
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
          label_url: null,
          pickup_scheduled_at: null,
          status: 'booked',
        },
        error: null,
      }),
    };
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'orders') {
          return { select: vi.fn(() => orderQuery) };
        }
        if (table === 'shipments') {
          return { select: vi.fn(() => shipmentQuery) };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const result = await bookOrderShipment(
      supabase as never,
      'merchant-1',
      'order-1'
    );

    expect(result.quoteId).toBe('quote-refreshed');
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });
});
