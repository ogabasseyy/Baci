import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import type { OrderShipmentBookingError } from '@/lib/shipping/order-shipment-booking-utils';
import {
  claimOrderShipmentBooking,
  clearOrderShipmentBookingLock,
} from './order-shipment-booking-lock';

function createSupabaseMock(options?: {
  rpcResult?: { data: unknown; error: unknown };
  clearResult?: { error: unknown };
}) {
  const updateBuilder = {
    eq: vi.fn().mockReturnThis(),
  };
  updateBuilder.eq.mockImplementation(() => updateBuilder);
  const finalEq = vi
    .fn()
    .mockResolvedValue(options?.clearResult ?? { error: null });
  updateBuilder.eq
    .mockImplementationOnce(() => updateBuilder)
    .mockImplementationOnce(() => updateBuilder)
    .mockImplementationOnce(finalEq);

  const supabase = {
    rpc: vi
      .fn()
      .mockResolvedValue(options?.rpcResult ?? { data: null, error: null }),
    from: vi.fn(() => ({
      update: vi.fn(() => updateBuilder),
    })),
  };

  return {
    rpc: supabase.rpc,
    finalEq,
    supabase: supabase as unknown as SupabaseClient,
  };
}

describe('claimOrderShipmentBooking', () => {
  it('returns claimed when the database lock is acquired', async () => {
    const { supabase, rpc } = createSupabaseMock({
      rpcResult: {
        data: [{ claimed: true, shipment_id: null, tracking_number: null }],
        error: null,
      },
    });

    const result = await claimOrderShipmentBooking(
      supabase,
      'merchant-1',
      'order-1'
    );

    expect(result.status).toBe('claimed');
    expect(rpc).toHaveBeenCalledWith('claim_order_shipment_booking', {
      p_order_id: 'order-1',
      p_merchant_id: 'merchant-1',
      p_lock_token: expect.any(String),
      p_lock_timeout_seconds: 900,
    });
  });

  it('returns already_booked when another request already attached a shipment', async () => {
    const { supabase } = createSupabaseMock({
      rpcResult: {
        data: [
          {
            claimed: false,
            shipment_id: 'shipment-1',
            tracking_number: 'TRACK-1',
          },
        ],
        error: null,
      },
    });

    await expect(
      claimOrderShipmentBooking(supabase, 'merchant-1', 'order-1')
    ).resolves.toEqual({ status: 'already_booked' });
  });

  it('returns in_progress when another request still owns the booking lock', async () => {
    const { supabase } = createSupabaseMock({
      rpcResult: {
        data: [
          {
            claimed: false,
            shipment_id: null,
            tracking_number: null,
          },
        ],
        error: null,
      },
    });

    await expect(
      claimOrderShipmentBooking(supabase, 'merchant-1', 'order-1')
    ).resolves.toEqual({ status: 'in_progress' });
  });

  it('throws ORDER_NOT_FOUND when the claim RPC returns no row', async () => {
    const { supabase } = createSupabaseMock({
      rpcResult: { data: [], error: null },
    });

    await expect(
      claimOrderShipmentBooking(supabase, 'merchant-1', 'order-1')
    ).rejects.toMatchObject({
      code: 'ORDER_NOT_FOUND',
      status: 404,
    } satisfies Partial<OrderShipmentBookingError>);
  });

  it('throws ORDER_REFUNDED when the claim observes a finalized refund', async () => {
    const { supabase } = createSupabaseMock({
      rpcResult: {
        data: null,
        error: {
          code: 'P0001',
          message: 'order_refunded_for_shipment',
        },
      },
    });

    await expect(
      claimOrderShipmentBooking(supabase, 'merchant-1', 'order-1')
    ).rejects.toMatchObject({
      code: 'ORDER_REFUNDED',
      status: 400,
    } satisfies Partial<OrderShipmentBookingError>);
  });

  it('throws ORDER_CANCELLED when the claim observes a cancelled order', async () => {
    const { supabase } = createSupabaseMock({
      rpcResult: {
        data: null,
        error: {
          code: 'P0001',
          message: 'order_cancelled_for_shipment',
        },
      },
    });

    await expect(
      claimOrderShipmentBooking(supabase, 'merchant-1', 'order-1')
    ).rejects.toMatchObject({
      code: 'ORDER_CANCELLED',
      status: 400,
    } satisfies Partial<OrderShipmentBookingError>);
  });

  it('throws ORDER_REFUND_PENDING when a partial refund is still settling', async () => {
    const { supabase } = createSupabaseMock({
      rpcResult: {
        data: null,
        error: {
          code: 'P0001',
          message: 'order_refund_pending_for_shipment',
        },
      },
    });

    await expect(
      claimOrderShipmentBooking(supabase, 'merchant-1', 'order-1')
    ).rejects.toMatchObject({
      code: 'ORDER_REFUND_PENDING',
      status: 409,
    } satisfies Partial<OrderShipmentBookingError>);
  });

  it('throws SHIPMENT_BOOKING_LOCK_FAILED when the claim RPC errors', async () => {
    const logSpy = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    const { supabase } = createSupabaseMock({
      rpcResult: {
        data: null,
        error: {
          code: '42702',
          message: 'private database detail',
        },
      },
    });

    try {
      await expect(
        claimOrderShipmentBooking(supabase, 'merchant-1', 'order-1')
      ).rejects.toMatchObject({
        code: 'SHIPMENT_BOOKING_LOCK_FAILED',
        status: 500,
      } satisfies Partial<OrderShipmentBookingError>);

      expect(logSpy).toHaveBeenCalledWith({
        message: 'Shipment booking lock claim failed',
        rpcCode: '42702',
      });
      expect(logSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.anything(),
        })
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it('logs UNKNOWN for malformed or oversized RPC error codes', async () => {
    const logSpy = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    const { supabase } = createSupabaseMock({
      rpcResult: {
        data: null,
        error: {
          code: 'private database detail that must not be logged',
          message: 'claim failed',
        },
      },
    });

    try {
      await expect(
        claimOrderShipmentBooking(supabase, 'merchant-1', 'order-1')
      ).rejects.toMatchObject({
        code: 'SHIPMENT_BOOKING_LOCK_FAILED',
        status: 500,
      } satisfies Partial<OrderShipmentBookingError>);

      expect(logSpy).toHaveBeenCalledWith({
        message: 'Shipment booking lock claim failed',
        rpcCode: 'UNKNOWN',
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  it('logs valid PostgREST codes without classifying them as UNKNOWN', async () => {
    const logSpy = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    const { supabase } = createSupabaseMock({
      rpcResult: {
        data: null,
        error: { code: 'PGRST116', message: 'claim failed' },
      },
    });

    try {
      await expect(
        claimOrderShipmentBooking(supabase, 'merchant-1', 'order-1')
      ).rejects.toMatchObject({
        code: 'SHIPMENT_BOOKING_LOCK_FAILED',
        status: 500,
      } satisfies Partial<OrderShipmentBookingError>);

      expect(logSpy).toHaveBeenCalledWith({
        message: 'Shipment booking lock claim failed',
        rpcCode: 'PGRST116',
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  it('degrades gracefully when the claim RPC is unavailable in production', async () => {
    const { supabase } = createSupabaseMock({
      rpcResult: {
        data: null,
        error: {
          code: '42883',
          message:
            'function public.claim_order_shipment_booking(uuid, uuid, text, integer) does not exist',
        },
      },
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // Silence expected warning for the fallback assertion.
    });

    await expect(
      claimOrderShipmentBooking(supabase, 'merchant-1', 'order-1')
    ).resolves.toEqual({
      status: 'claimed',
      lockToken: null,
    });

    warnSpy.mockRestore();
  });
});

describe('clearOrderShipmentBookingLock', () => {
  it('clears the booking lock when the update succeeds', async () => {
    const { supabase, finalEq } = createSupabaseMock();

    await expect(
      clearOrderShipmentBookingLock(supabase, 'merchant-1', 'order-1', 'lock-1')
    ).resolves.toBeUndefined();

    expect(finalEq).toHaveBeenCalledWith(
      'shipment_booking_lock_token',
      'lock-1'
    );
  });

  it('throws when the lock release update fails', async () => {
    const { supabase } = createSupabaseMock({
      clearResult: { error: { message: 'update failed' } },
    });

    await expect(
      clearOrderShipmentBookingLock(supabase, 'merchant-1', 'order-1', 'lock-1')
    ).rejects.toMatchObject({
      code: 'SHIPMENT_BOOKING_LOCK_RELEASE_FAILED',
      status: 500,
    } satisfies Partial<OrderShipmentBookingError>);
  });
});
