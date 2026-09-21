import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderShipmentBookingError } from './order-shipment-booking-error';
import { persistBookedOrderShipment } from './persist-booked-order-shipment';
import type { OrderShipmentQuoteRecord } from './refresh-order-shipment-quote';

const mocks = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock('./confirm-booked-order-payment-persist', () => ({
  confirmBookedOrderPaymentPersist: mocks.confirm,
}));

const mockConfirm = mocks.confirm;

describe('persistBookedOrderShipment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(undefined);
  });

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
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        provider: 'GIGL',
        providerShipmentId: 'ps-1',
        trackingNumber: 'TRK-1',
      })
    );
  });

  it('refuses the persist when a refund finalized after the provider submit', async () => {
    mockConfirm.mockRejectedValue(
      new OrderShipmentBookingError(
        'This order was refunded after the provider booking was submitted.',
        409,
        'ORDER_REFUNDED_AFTER_BOOKING'
      )
    );
    const insert = vi.fn();
    const supabase = {
      from: vi.fn(() => ({ insert })),
    };

    await expect(
      persistBookedOrderShipment(supabase as never, {
        merchantId: 'merchant-1',
        orderId: 'order-1',
        quote: { id: 'quote-1' } as OrderShipmentQuoteRecord,
        result: {
          provider: 'GIGL',
          providerShipmentId: 'ps-1',
          trackingNumber: 'TRK-1',
        } as never,
        sender: {} as never,
        receiver: {} as never,
        items: [],
      })
    ).rejects.toMatchObject({ code: 'ORDER_REFUNDED_AFTER_BOOKING' });
    expect(insert).not.toHaveBeenCalled();
  });
});
