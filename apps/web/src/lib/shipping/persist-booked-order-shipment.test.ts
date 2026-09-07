import { describe, expect, it, vi } from 'vitest';
import { persistBookedOrderShipment } from './persist-booked-order-shipment';
import type { OrderShipmentQuoteRecord } from './refresh-order-shipment-quote';

describe('persistBookedOrderShipment', () => {
  it('inserts the shipment and marks the quote used', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'shipments') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'shipment-1' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'shipping_quotes') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({ eq: updateEq }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    await expect(
      persistBookedOrderShipment(supabase as never, {
        merchantId: 'merchant-1',
        orderId: 'order-1',
        quote: {
          id: 'quote-1',
          price: 2500,
          currency: 'NGN',
          estimated_days: 3,
        } as OrderShipmentQuoteRecord,
        result: {
          provider: 'GIGL',
          providerShipmentId: 'ps-1',
          trackingNumber: 'TRK-1',
          carrierName: 'GIG Logistics',
          status: 'booked',
        },
        sender: {
          name: 'Store',
          phone: '0801',
          address: '1 Market',
          city: 'Lagos',
          state: 'Lagos',
          country: 'Nigeria',
          countryCode: 'NG',
        },
        receiver: {
          name: 'Customer',
          phone: '0802',
          address: '2 Home',
          city: 'Lagos',
          state: 'Lagos',
          country: 'Nigeria',
          countryCode: 'NG',
        },
        items: [{ name: 'Widget', quantity: 1, weight: 1, value: 5000 }],
      })
    ).resolves.toEqual({ shipmentId: 'shipment-1' });
    expect(updateEq).toHaveBeenCalled();
  });
});
