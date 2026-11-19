import { describe, expect, it, vi } from 'vitest';
import { attachCancellationRefundMode } from './attach-cancellation-refund-mode';

function supabaseWith(result: unknown, throws = false) {
  const maybeSingle = throws
    ? vi.fn().mockRejectedValue(new Error('down'))
    : vi.fn().mockResolvedValue(result);
  const eqMerchant = vi.fn(() => ({ maybeSingle }));
  const eqId = vi.fn(() => ({ eq: eqMerchant }));
  return {
    eqId,
    eqMerchant,
    supabase: {
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: eqId })) })),
    } as never,
  };
}

const args = (supabase: never) => ({
  merchantId: 'm1',
  orderId: 'o1',
  supabase,
});

describe('attachCancellationRefundMode', () => {
  it('adds the persisted manual mode, scoped to the merchant', async () => {
    const { eqId, eqMerchant, supabase } = supabaseWith({
      data: { cancellation_refund_mode: 'manual' },
      error: null,
    });
    const out = await attachCancellationRefundMode(
      { status: 'not_started' },
      args(supabase)
    );
    expect(out).toMatchObject({ cancellationRefundMode: 'manual' });
    expect(eqId).toHaveBeenCalledWith('id', 'o1');
    expect(eqMerchant).toHaveBeenCalledWith('merchant_id', 'm1');
  });

  it('adds automatic and maps a legacy null to null', async () => {
    const automatic = await attachCancellationRefundMode(
      {},
      args(
        supabaseWith({
          data: { cancellation_refund_mode: 'automatic' },
          error: null,
        }).supabase
      )
    );
    const legacy = await attachCancellationRefundMode(
      {},
      args(
        supabaseWith({
          data: { cancellation_refund_mode: null },
          error: null,
        }).supabase
      )
    );
    expect(automatic).toMatchObject({ cancellationRefundMode: 'automatic' });
    expect(legacy).toMatchObject({ cancellationRefundMode: null });
  });

  it('marks the mode unknown when the read fails or throws', async () => {
    const summary = { status: 'not_started' };
    await expect(
      attachCancellationRefundMode(
        summary,
        args(supabaseWith({ data: null, error: { message: 'x' } }).supabase)
      )
    ).resolves.toEqual({ ...summary, cancellationRefundMode: 'unknown' });
    await expect(
      attachCancellationRefundMode(
        summary,
        args(supabaseWith(null, true).supabase)
      )
    ).resolves.toEqual({ ...summary, cancellationRefundMode: 'unknown' });
  });
});
