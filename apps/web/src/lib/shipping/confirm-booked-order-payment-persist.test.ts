import { describe, expect, it, vi } from 'vitest';
import { confirmBookedOrderPaymentPersist } from './confirm-booked-order-payment-persist';
import { OrderShipmentBookingError } from './order-shipment-booking-error';

function mockSupabase(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as never;
}

const input = {
  merchantId: 'merchant-1',
  orderId: 'order-1',
  provider: 'GIGL',
  providerShipmentId: 'ps-1',
  trackingNumber: 'TRK-1',
};

describe('confirmBookedOrderPaymentPersist', () => {
  it('passes the persist through when the order is still payable', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { persist_allowed: true, duplicate: false },
      error: null,
    });

    await expect(
      confirmBookedOrderPaymentPersist({
        ...input,
        supabase: mockSupabase(rpc),
      })
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith(
      'confirm_shippable_order_payment_for_booking_persist',
      {
        p_order_id: 'order-1',
        p_merchant_id: 'merchant-1',
        p_provider: 'GIGL',
        p_provider_shipment_id: 'ps-1',
        p_tracking_number: 'TRK-1',
      }
    );
  });

  it('refuses the persist when a refund finalized after the provider submit', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { persist_allowed: false, duplicate: false },
      error: null,
    });

    const failure = await confirmBookedOrderPaymentPersist({
      ...input,
      supabase: mockSupabase(rpc),
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OrderShipmentBookingError);
    expect((failure as OrderShipmentBookingError).code).toBe(
      'ORDER_REFUNDED_AFTER_BOOKING'
    );
    expect((failure as OrderShipmentBookingError).status).toBe(409);
  });

  it('refuses the persist on a duplicate interception receipt', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ persist_allowed: false, duplicate: true }],
      error: null,
    });

    const failure = await confirmBookedOrderPaymentPersist({
      ...input,
      supabase: mockSupabase(rpc),
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OrderShipmentBookingError);
    expect((failure as OrderShipmentBookingError).code).toBe(
      'ORDER_REFUNDED_AFTER_BOOKING'
    );
  });

  it('fails closed when the order vanished mid-booking', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'order_not_found_for_shipment' },
    });

    const failure = await confirmBookedOrderPaymentPersist({
      ...input,
      supabase: mockSupabase(rpc),
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OrderShipmentBookingError);
    expect((failure as OrderShipmentBookingError).code).toBe('ORDER_NOT_FOUND');
  });

  it('fails closed on unexpected confirm failures', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'connection reset' },
    });

    const failure = await confirmBookedOrderPaymentPersist({
      ...input,
      supabase: mockSupabase(rpc),
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OrderShipmentBookingError);
    expect((failure as OrderShipmentBookingError).code).toBe(
      'SHIPMENT_BOOKING_STATE_CHECK_FAILED'
    );
  });
});
