import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retireTerminalSideEffectDrain } from '@/lib/payments/retire-terminal-side-effect-drain';

const mocks = vi.hoisted(() => ({ retireWedgeWithReview: vi.fn() }));

vi.mock('@/lib/payments/retire-wedge-with-review', () => ({
  retireWedgeWithReview: mocks.retireWedgeWithReview,
}));

function buildSupabase(updateError: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain.update = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockResolvedValue({ error: updateError });
  return {
    chain,
    supabase: {
      from: vi.fn().mockReturnValue(chain),
    } as unknown as SupabaseClient,
  };
}

const transaction = {
  gateway: 'paystack',
  gateway_reference: 'REF-1',
  id: 'txn-1',
  metadata: null,
  order_id: 'order-1',
};

beforeEach(() => vi.clearAllMocks());

describe('retireTerminalSideEffectDrain', () => {
  it('files review before permanently retiring replayable steps', async () => {
    const { chain, supabase } = buildSupabase();
    mocks.retireWedgeWithReview.mockResolvedValue(true);

    await expect(
      retireTerminalSideEffectDrain({
        fileWedgeReview: mocks.retireWedgeWithReview,
        orderId: 'order-1',
        reason: 'gateway rejected reference',
        resolution: 'gateway_reference_invalid',
        supabase,
        transaction,
      })
    ).resolves.toBe(true);

    expect(mocks.retireWedgeWithReview).toHaveBeenCalledTimes(1);
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'gateway_verification_terminal' })
    );
    expect(chain.in).toHaveBeenCalledWith('step', [
      'paid_email',
      'ad_tracking_conversion',
      'merchant_settlement',
    ]);
  });

  it('leaves the drain eligible when durable review filing fails', async () => {
    const { chain, supabase } = buildSupabase();
    mocks.retireWedgeWithReview.mockResolvedValue(false);

    await expect(
      retireTerminalSideEffectDrain({
        fileWedgeReview: mocks.retireWedgeWithReview,
        orderId: 'order-1',
        reason: 'gateway rejected reference',
        resolution: 'gateway_reference_invalid',
        supabase,
        transaction,
      })
    ).resolves.toBe(false);

    expect(chain.update).not.toHaveBeenCalled();
  });
});
