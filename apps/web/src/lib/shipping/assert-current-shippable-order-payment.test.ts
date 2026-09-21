import { describe, expect, it, vi } from 'vitest';
import { assertCurrentOrderPaymentShippable } from './assert-current-shippable-order-payment';
import { OrderShipmentBookingError } from './order-shipment-booking-error';

function mockSupabase(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as never;
}

describe('assertCurrentOrderPaymentShippable', () => {
  it('passes when the serialized check succeeds', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await expect(
      assertCurrentOrderPaymentShippable(
        mockSupabase(rpc),
        'merchant-1',
        'order-1'
      )
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('assert_shippable_order_payment', {
      p_order_id: 'order-1',
      p_merchant_id: 'merchant-1',
    });
  });

  it('rejects a refund that finalized since the booking read', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'order_refunded_for_shipment' },
    });

    const failure = await assertCurrentOrderPaymentShippable(
      mockSupabase(rpc),
      'merchant-1',
      'order-1'
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OrderShipmentBookingError);
    expect((failure as OrderShipmentBookingError).code).toBe('ORDER_REFUNDED');
    expect((failure as OrderShipmentBookingError).status).toBe(400);
  });

  it('fails closed when the order vanished mid-booking', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'order_not_found_for_shipment' },
    });

    const failure = await assertCurrentOrderPaymentShippable(
      mockSupabase(rpc),
      'merchant-1',
      'order-1'
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OrderShipmentBookingError);
    expect((failure as OrderShipmentBookingError).code).toBe('ORDER_NOT_FOUND');
  });

  it('fails closed on unexpected check failures', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'connection reset' },
    });

    const failure = await assertCurrentOrderPaymentShippable(
      mockSupabase(rpc),
      'merchant-1',
      'order-1'
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OrderShipmentBookingError);
    expect((failure as OrderShipmentBookingError).code).toBe(
      'SHIPMENT_BOOKING_STATE_CHECK_FAILED'
    );
  });
});
