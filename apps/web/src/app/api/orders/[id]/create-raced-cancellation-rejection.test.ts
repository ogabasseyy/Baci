import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createRacedCancellationRejection } from './create-raced-cancellation-rejection';

function supabaseWithOrder(
  order: {
    payment_status: string | null;
    shipping_status: string | null;
  } | null
) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve({ data: order, error: null })),
  };
  return {
    from: vi.fn(() => builder),
  } as unknown as SupabaseClient;
}

describe('createRacedCancellationRejection', () => {
  it('answers the terminal rejection when the fresh row is cancelled', async () => {
    const reject = createRacedCancellationRejection({
      supabase: supabaseWithOrder({
        payment_status: 'cancelled',
        shipping_status: 'pending',
      }),
      merchantId: 'merchant-1',
      orderId: 'order-1',
      requestedPaymentStatus: 'paid',
      requestedShippingStatus: undefined,
    });

    await expect(reject()).resolves.toMatchObject({
      code: 'PAYMENT_CANCELLED_TERMINAL',
    });
  });

  it('returns null when the fresh row is still active', async () => {
    const reject = createRacedCancellationRejection({
      supabase: supabaseWithOrder({
        payment_status: 'unpaid',
        shipping_status: 'pending',
      }),
      merchantId: 'merchant-1',
      orderId: 'order-1',
      requestedPaymentStatus: 'paid',
      requestedShippingStatus: undefined,
    });

    await expect(reject()).resolves.toBeNull();
  });

  it('propagates a failed re-read instead of reporting no race', async () => {
    const failure = { code: 'XX000', message: 'connection lost' };
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      single: vi.fn(() => Promise.resolve({ data: null, error: failure })),
    };
    const reject = createRacedCancellationRejection({
      supabase: { from: vi.fn(() => builder) } as unknown as SupabaseClient,
      merchantId: 'merchant-1',
      orderId: 'order-1',
      requestedPaymentStatus: 'paid',
      requestedShippingStatus: undefined,
    });

    await expect(reject()).rejects.toBe(failure);
  });

  it('returns null when the row is gone', async () => {
    const reject = createRacedCancellationRejection({
      supabase: supabaseWithOrder(null),
      merchantId: 'merchant-1',
      orderId: 'order-1',
      requestedPaymentStatus: 'paid',
      requestedShippingStatus: undefined,
    });

    await expect(reject()).resolves.toBeNull();
  });
});
