import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sweepPaystackRefundRecoveryWatches } from './sweep-paystack-refund-recovery-watches';

const mocks = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  recover: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: mocks.loggerWarn },
}));
vi.mock('./recover-unknown-paystack-refund', () => ({
  recoverUnknownPaystackRefund: mocks.recover,
}));

function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const key of ['eq', 'lt', 'order', 'limit', 'select', 'update']) {
    builder[key] = vi.fn().mockReturnValue(builder);
  }
  // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
  builder.then = (resolve: (value: unknown) => void) => resolve(result);
  return builder;
}

function database({
  retire = { data: [], error: null },
  watches = { data: [], error: null },
}: {
  retire?: { data: unknown; error: unknown };
  watches?: { data: unknown; error: unknown };
} = {}) {
  const from = vi
    .fn()
    .mockReturnValueOnce(chain(retire))
    .mockReturnValueOnce(chain(watches));
  return { from, supabase: { from } as unknown as SupabaseClient };
}

describe('sweepPaystackRefundRecoveryWatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retires stale watches and re-drives the remaining open ones', async () => {
    mocks.recover.mockResolvedValue(undefined);
    const { from, supabase } = database({
      retire: { data: [{ id: 'watch-old' }], error: null },
      watches: {
        data: [
          {
            created_at: '2026-09-30T00:00:00Z',
            id: 'watch-1',
            paystack_ref: 'PSK-1',
            provider_refund_id: 202,
          },
        ],
        error: null,
      },
    });

    const summary = await sweepPaystackRefundRecoveryWatches(supabase);

    expect(from).toHaveBeenNthCalledWith(1, 'paystack_refund_recovery_watch');
    expect(from).toHaveBeenNthCalledWith(2, 'paystack_refund_recovery_watch');
    expect(mocks.recover).toHaveBeenCalledWith(supabase, 202, 'PSK-1');
    expect(summary).toEqual({
      checked: 1,
      failed: 0,
      redriven: 1,
      retired: 1,
    });
  });

  it('counts failures per row instead of throwing', async () => {
    mocks.recover.mockRejectedValueOnce(new Error('provider down'));
    mocks.recover.mockResolvedValueOnce(undefined);
    const { supabase } = database({
      watches: {
        data: [
          {
            created_at: '2026-09-30T00:00:00Z',
            id: 'watch-1',
            paystack_ref: 'PSK-1',
            provider_refund_id: 202,
          },
          {
            created_at: '2026-09-30T00:00:01Z',
            id: 'watch-2',
            paystack_ref: 'PSK-2',
            provider_refund_id: 203,
          },
        ],
        error: null,
      },
    });

    const summary = await sweepPaystackRefundRecoveryWatches(supabase);

    expect(summary).toEqual({
      checked: 2,
      failed: 1,
      redriven: 1,
      retired: 0,
    });
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ watchId: 'watch-1', refundId: 202 })
    );
  });

  it('stops starting rows past the deadline', async () => {
    mocks.recover.mockResolvedValue(undefined);
    const { supabase } = database({
      watches: {
        data: [
          {
            created_at: '2026-09-30T00:00:00Z',
            id: 'watch-1',
            paystack_ref: 'PSK-1',
            provider_refund_id: 202,
          },
        ],
        error: null,
      },
    });

    const summary = await sweepPaystackRefundRecoveryWatches(
      supabase,
      25,
      Date.now() - 1
    );

    expect(mocks.recover).not.toHaveBeenCalled();
    expect(summary.checked).toBe(0);
  });

  it('throws when the watch lookup fails', async () => {
    const { supabase } = database({
      watches: { data: null, error: { code: 'ECONNRESET' } },
    });

    await expect(sweepPaystackRefundRecoveryWatches(supabase)).rejects.toThrow(
      'refund_recovery_watch_lookup_failed'
    );
  });
});
