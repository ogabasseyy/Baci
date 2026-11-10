import { describe, expect, it, vi } from 'vitest';
import { attachCancellationRefundMode } from './attach-cancellation-refund-mode';

function supabaseWith(result: unknown, throws = false) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: throws
            ? vi.fn().mockRejectedValue(new Error('down'))
            : vi.fn().mockResolvedValue(result),
        })),
      })),
    })),
  } as never;
}

const args = (supabase: never) => ({ orderId: 'o1', supabase });

describe('attachCancellationRefundMode', () => {
  it('adds the persisted manual mode', async () => {
    const out = await attachCancellationRefundMode(
      { status: 'not_started' },
      args(
        supabaseWith({
          data: { cancellation_refund_mode: 'manual' },
          error: null,
        })
      )
    );
    expect(out).toMatchObject({ cancellationRefundMode: 'manual' });
  });

  it('adds automatic and maps a legacy null to null', async () => {
    const automatic = await attachCancellationRefundMode(
      {},
      args(
        supabaseWith({
          data: { cancellation_refund_mode: 'automatic' },
          error: null,
        })
      )
    );
    const legacy = await attachCancellationRefundMode(
      {},
      args(
        supabaseWith({
          data: { cancellation_refund_mode: null },
          error: null,
        })
      )
    );
    expect(automatic).toMatchObject({ cancellationRefundMode: 'automatic' });
    expect(legacy).toMatchObject({ cancellationRefundMode: null });
  });

  it('returns the summary unchanged when the read fails or throws', async () => {
    const summary = { status: 'not_started' };
    await expect(
      attachCancellationRefundMode(
        summary,
        args(supabaseWith({ data: null, error: { message: 'x' } }))
      )
    ).resolves.toBe(summary);
    await expect(
      attachCancellationRefundMode(summary, args(supabaseWith(null, true)))
    ).resolves.toBe(summary);
  });
});
