import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeferredError,
  DeliveryUncertainError,
  runOrderCancellationSideEffect,
} from './run-order-cancellation-side-effect';

function client(
  claim: { current_status: string; we_won: boolean },
  finish: { data: unknown; error: unknown } = { data: true, error: null }
) {
  const rpc = vi.fn((name: string) => {
    if (name === 'claim_order_cancellation_side_effect') {
      return {
        single: vi.fn().mockResolvedValue({ data: claim, error: null }),
      };
    }
    return Promise.resolve(finish);
  });
  const builder: Record<string, unknown> = {
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaited thenables.
    then: (resolve: (result: unknown) => void) =>
      resolve({ data: null, error: null }),
  };
  builder.eq = vi.fn().mockReturnValue(builder);
  const update = vi.fn().mockReturnValue(builder);
  const from = vi.fn().mockReturnValue({ update });
  return { from, rpc, update };
}

describe('runOrderCancellationSideEffect', () => {
  beforeEach(() => vi.stubGlobal('crypto', { randomUUID: () => 'claim-1' }));

  it('executes and completes a won claim', async () => {
    const supabase = client({ current_status: 'claimed', we_won: true });
    const execute = vi.fn().mockResolvedValue({ refundId: 1 });

    await expect(
      runOrderCancellationSideEffect({
        execute,
        orderId: 'order-1',
        step: 'refund',
        supabase: supabase as never,
      })
    ).resolves.toBe('completed');
    expect(execute).toHaveBeenCalledOnce();
    expect(supabase.rpc).toHaveBeenLastCalledWith(
      'finish_order_cancellation_side_effect',
      expect.objectContaining({ p_status: 'completed' })
    );
  });

  it('does not repeat completed or concurrently claimed work', async () => {
    const supabase = client({ current_status: 'completed', we_won: false });
    const execute = vi.fn();

    await expect(
      runOrderCancellationSideEffect({
        execute,
        orderId: 'order-1',
        step: 'customer_email',
        supabase: supabase as never,
      })
    ).resolves.toBe('completed');
    expect(execute).not.toHaveBeenCalled();
  });

  it('defers provider-awaiting work without failing it', async () => {
    const supabase = client({ current_status: 'claimed', we_won: true });

    await expect(
      runOrderCancellationSideEffect({
        execute: async () => {
          throw new DeferredError(
            'cancellation_refund_awaiting_provider_completion'
          );
        },
        orderId: 'order-1',
        step: 'refund',
        supabase: supabase as never,
      })
    ).resolves.toBe('deferred');
    expect(supabase.rpc).toHaveBeenLastCalledWith(
      'finish_order_cancellation_side_effect',
      expect.objectContaining({ p_status: 'deferred' })
    );
  });

  it('restores a deferred row when the finish write fails', async () => {
    const supabase = client(
      { current_status: 'claimed', we_won: true },
      { data: null, error: new Error('db down') }
    );

    await expect(
      runOrderCancellationSideEffect({
        execute: async () => {
          throw new DeferredError(
            'cancellation_refund_awaiting_provider_completion'
          );
        },
        orderId: 'order-1',
        step: 'refund',
        supabase: supabase as never,
      })
    ).resolves.toBe('deferred');
    // Without the restore the row would sit claimed until a stale-claim
    // sweep terminalized it, stranding the uninitiated leg forever.
    expect(supabase.from).toHaveBeenCalledWith(
      'order_cancellation_side_effects'
    );
    expect(supabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'deferred' })
    );
    const eq = (supabase.update.mock.results[0]?.value as Record<string, any>)
      .eq as ReturnType<typeof vi.fn>;
    expect(eq).toHaveBeenCalledWith('status', 'claimed');
    expect(eq).toHaveBeenCalledWith('claim_token', 'claim-1');
  });

  it('terminalizes a completed row when the finish write fails', async () => {
    const supabase = client(
      { current_status: 'claimed', we_won: true },
      { data: false, error: null }
    );
    const execute = vi.fn().mockResolvedValue({ refundId: 1 });

    await expect(
      runOrderCancellationSideEffect({
        execute,
        orderId: 'order-1',
        step: 'refund',
        supabase: supabase as never,
      })
    ).resolves.toBe('delivery_uncertain');
    expect(supabase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('could not be persisted'),
        result: { refundId: 1 },
        status: 'delivery_uncertain',
      })
    );
  });

  it('persists ambiguous provider delivery without retrying it', async () => {
    const supabase = client({ current_status: 'claimed', we_won: true });

    await expect(
      runOrderCancellationSideEffect({
        execute: async () => {
          throw new DeliveryUncertainError('network failure');
        },
        orderId: 'order-1',
        step: 'refund',
        supabase: supabase as never,
      })
    ).resolves.toBe('delivery_uncertain');
    expect(supabase.rpc).toHaveBeenLastCalledWith(
      'finish_order_cancellation_side_effect',
      expect.objectContaining({ p_status: 'delivery_uncertain' })
    );
  });
});
