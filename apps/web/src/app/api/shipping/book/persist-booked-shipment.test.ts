import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderShipmentBookingError } from '@/lib/shipping/order-shipment-booking-utils';
import { persistBookedShipment } from './persist-booked-shipment';

const mocks = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock('@/lib/shipping/confirm-booked-order-payment-persist', () => ({
  confirmBookedOrderPaymentPersist: mocks.confirm,
}));

const mockConfirm = mocks.confirm;

const baseParams = {
  orderId: 'order-1',
  merchantId: 'merchant-1',
  senderInfo: {
    name: 'Merchant',
    phone: '0800',
    address: '1 Road',
    city: 'Ikeja',
    state: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
  },
  receiver: {
    name: 'Customer',
    phone: '0801',
    address: '2 Road',
    city: 'Lagos',
    state: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
  },
  items: [{ name: 'Phone', quantity: 1, weight: 1, value: 100 }],
  bookingQuote: {
    id: 'quote-1',
    merchant_id: 'merchant-1',
    provider: 'GIGL',
    service_tier: 'GoStandard',
    carrier_name: 'GIG Logistics',
    price: 2500,
    currency: 'NGN',
    estimated_days: 2,
    provider_rate_id: 'GIGL_1',
    expires_at: new Date().toISOString(),
    quote_request: {},
    provider_metadata: {},
  },
  result: {
    provider: 'GIGL' as const,
    providerShipmentId: 'waybill-1',
    trackingNumber: 'waybill-1',
    carrierName: 'GIG Logistics',
    status: 'booked' as const,
    rawResponse: {},
  },
};

function createUpdateChain(resolved: { error: unknown }) {
  const secondEq = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({
        data: resolved.error ? null : { id: 'order-1' },
        error: resolved.error,
      }),
    }),
  });
  const eq = vi.fn().mockReturnValue({ eq: secondEq });
  return Object.assign(eq, { secondEq });
}

describe('persistBookedShipment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(undefined);
  });

  it('returns a 409 payload when a refund finalized after the provider submit', async () => {
    mockConfirm.mockRejectedValue(
      new OrderShipmentBookingError(
        'This order was refunded after the provider booking was submitted.',
        409,
        'ORDER_REFUNDED_AFTER_BOOKING'
      )
    );
    const insert = vi.fn();
    const supabase = { from: vi.fn(() => ({ insert })) };

    const result = await persistBookedShipment({
      ...baseParams,
      supabase: supabase as never,
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      trackingNumber: 'waybill-1',
      error: expect.stringContaining('waybill-1'),
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it('returns a 500 payload when the shipment insert fails', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'insert failed' },
            }),
          }),
        }),
      }),
    };

    const result = await persistBookedShipment({
      ...baseParams,
      supabase: supabase as never,
    });

    expect(result).toEqual({
      ok: false,
      status: 500,
      trackingNumber: 'waybill-1',
      error: expect.stringContaining('waybill-1'),
    });
  });

  it('persists the shipment, updates the order, and marks the quote used', async () => {
    const orderUpdateEq = createUpdateChain({ error: null });
    const quoteUpdateEq = createUpdateChain({ error: null });

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
        if (table === 'orders') {
          return {
            update: vi.fn().mockReturnValue({
              eq: orderUpdateEq,
            }),
          };
        }
        if (table === 'shipping_quotes') {
          return {
            update: vi.fn().mockReturnValue({
              eq: quoteUpdateEq,
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await persistBookedShipment({
      ...baseParams,
      supabase: supabase as never,
    });

    expect(result).toEqual({ ok: true, shipmentId: 'shipment-1' });
    expect(orderUpdateEq).toHaveBeenCalledWith('id', 'order-1');
    expect(orderUpdateEq.secondEq).toHaveBeenCalledWith(
      'merchant_id',
      'merchant-1'
    );
    expect(quoteUpdateEq).toHaveBeenCalledWith('id', 'quote-1');
    expect(quoteUpdateEq.secondEq).toHaveBeenCalledWith(
      'merchant_id',
      'merchant-1'
    );
  });

  it('returns a 500 payload when the order update fails after insert', async () => {
    const orderUpdateEq = createUpdateChain({
      error: { message: 'order update failed' },
    });

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
        if (table === 'orders') {
          return {
            update: vi.fn().mockReturnValue({ eq: orderUpdateEq }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await persistBookedShipment({
      ...baseParams,
      supabase: supabase as never,
    });

    expect(result).toEqual({
      ok: false,
      status: 500,
      trackingNumber: 'waybill-1',
      error: expect.stringContaining(
        'failed to update order. Contact support with tracking number: waybill-1'
      ),
    });
  });

  it('returns a 500 payload when the order update matches no row', async () => {
    const orderUpdateEq = createUpdateChain({ error: null });
    orderUpdateEq.secondEq.mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    });

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
        if (table === 'orders') {
          return {
            update: vi.fn().mockReturnValue({ eq: orderUpdateEq }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await persistBookedShipment({
      ...baseParams,
      supabase: supabase as never,
    });

    expect(result).toEqual({
      ok: false,
      status: 500,
      trackingNumber: 'waybill-1',
      error: expect.stringContaining(
        'failed to update order. Contact support with tracking number: waybill-1'
      ),
    });
  });
});
