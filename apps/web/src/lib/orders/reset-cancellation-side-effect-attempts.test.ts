import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { tryResetCancellationSideEffectAttempts } from './reset-cancellation-side-effect-attempts';

function database(outcome: unknown) {
  const terminalEq = vi.fn().mockResolvedValue(outcome);
  const eq = vi.fn().mockReturnValue({ eq: terminalEq });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  const supabase = { from } as unknown as Pick<SupabaseClient, 'from'>;
  return { eq, from, supabase, terminalEq, update };
}

describe('tryResetCancellationSideEffectAttempts', () => {
  it('returns false when the reset lands', async () => {
    const { eq, from, supabase, terminalEq, update } = database({
      data: null,
      error: null,
    });

    await expect(
      tryResetCancellationSideEffectAttempts(supabase, 'order-1', 'refund')
    ).resolves.toBe(false);
    expect(from).toHaveBeenCalledWith('order_cancellation_side_effects');
    expect(update).toHaveBeenCalledWith({ attempts: 0 });
    expect(eq).toHaveBeenCalledWith('order_id', 'order-1');
    expect(terminalEq).toHaveBeenCalledWith('step', 'refund');
  });

  it('returns true when the write resolves an error', async () => {
    const { supabase } = database({ data: null, error: { code: 'CONN' } });

    // Supabase resolves write failures instead of throwing: callers
    // must see the failure or they defer on a budget that never reset.
    await expect(
      tryResetCancellationSideEffectAttempts(supabase, 'order-1', 'refund')
    ).resolves.toBe(true);
  });

  it('returns true when the write throws', async () => {
    const from = vi.fn().mockImplementation(() => {
      throw new Error('network down');
    });
    const supabase = { from } as unknown as Pick<SupabaseClient, 'from'>;

    await expect(
      tryResetCancellationSideEffectAttempts(supabase, 'order-1', 'refund')
    ).resolves.toBe(true);
  });
});
