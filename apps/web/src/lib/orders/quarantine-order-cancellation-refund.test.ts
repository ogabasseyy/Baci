import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { quarantineRefund } from './quarantine-order-cancellation-refund';
import {
  order,
  transaction,
} from './quarantine-order-cancellation-refund.test-helpers';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

describe('quarantineRefund', () => {
  it('keeps a preflight review-write failure retryable', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: 'XX000' } });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
    } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>;

    const error = await quarantineRefund({
      order,
      preflight: true,
      reason: 'unsupported gateway',
      supabase,
      transactions: [transaction],
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DeliveryUncertainError);
    expect((error as Error).message).toMatch('filing the review failed');
  });

  it('keeps a duplicate preflight review quarantined', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
      rpc,
    } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>;

    await expect(
      quarantineRefund({
        order,
        preflight: true,
        reason: 'unsupported gateway',
        supabase,
        transactions: [transaction],
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
  });

  it('keeps an accepted refund uncertain when review persistence fails', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '42501' } });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
    } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>;

    await expect(
      quarantineRefund({
        metadata: { provider_refund_id: 123 },
        order,
        reason: 'provider evidence mismatch',
        supabase,
        transactions: [transaction],
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: expect.arrayContaining([
          expect.objectContaining({ gatewayReference: 'PAY-123' }),
        ]),
        issue_type: 'order_cancellation_refund_requires_review',
        metadata: { provider_refund_id: 123 },
        // The open-by-paystack-ref index is global: stamping the shared
        // reference would collide with another order's review while the
        // merge RPCs only search this order.
        paystack_ref: null,
      })
    );
  });
});
