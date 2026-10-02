import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sweepPaystackRefundRecoveryWatches } from './sweep-paystack-refund-recovery-watches';

const mocks = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  reconcile: vi.fn(),
  recover: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: mocks.loggerWarn },
}));
vi.mock('./reconcile-paystack-refund-event', () => ({
  reconcilePaystackRefundEvent: mocks.reconcile,
}));
vi.mock('./recover-unknown-paystack-refund', () => ({
  recoverUnknownPaystackRefund: mocks.recover,
}));

function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const key of ['eq', 'in', 'lt', 'order', 'limit', 'select', 'update']) {
    builder[key] = vi.fn().mockReturnValue(builder);
  }
  // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
  builder.then = (resolve: (value: unknown) => void) => resolve(result);
  return builder;
}

function database({
  watches = { data: [], error: null },
  writes = { data: [], error: null },
}: {
  watches?: { data: unknown; error: unknown };
  writes?: { data: unknown; error: unknown };
} = {}) {
  const selectChain = chain(watches);
  // One shared write chain: the rotation update runs only when a row
  // failed, so the retire call's position varies by test.
  const writeChain = chain(writes);
  const from = vi
    .fn()
    .mockReturnValueOnce(selectChain)
    .mockReturnValue(writeChain);
  return {
    from,
    selectChain,
    supabase: { from } as unknown as SupabaseClient,
    writeChain,
  };
}

describe('sweepPaystackRefundRecoveryWatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-drives open watches before retiring the stale ones', async () => {
    mocks.recover.mockResolvedValue(undefined);
    const { from, writeChain, supabase } = database({
      writes: { data: [{ id: 'watch-1' }], error: null },
      watches: {
        data: [
          {
            created_at: '2026-09-20T00:00:00Z',
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
    // Retirement only covers redriven watches recovery left open: a
    // handled watch resolves during the redrive and the status filter
    // skips it.
    expect(writeChain.in as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'id',
      ['watch-1']
    );
    expect(summary).toEqual({
      checked: 1,
      failed: 0,
      redriven: 1,
      retired: 1,
    });
  });

  it('re-drives reference-only watches through the reference-only path', async () => {
    mocks.reconcile.mockResolvedValue(undefined);
    const { supabase } = database({
      watches: {
        data: [
          {
            created_at: '2026-09-30T00:00:00Z',
            evidence: {
              provider_refund_status: 'processed',
              reference_only: true,
            },
            id: 'watch-ref',
            paystack_ref: 'PSK-9',
            provider_refund_id: null,
          },
        ],
        error: null,
      },
    });

    const summary = await sweepPaystackRefundRecoveryWatches(supabase);

    expect(mocks.reconcile).toHaveBeenCalledWith(
      supabase,
      'PSK-9',
      'processed'
    );
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(summary).toEqual({
      checked: 1,
      failed: 0,
      redriven: 1,
      retired: 0,
    });
  });

  it('counts failures per row and never retires a failed redrive', async () => {
    mocks.recover.mockRejectedValueOnce(new Error('provider down'));
    mocks.recover.mockResolvedValueOnce(undefined);
    const { writeChain, supabase } = database({
      watches: {
        data: [
          {
            created_at: '2026-09-20T00:00:00Z',
            id: 'watch-1',
            paystack_ref: 'PSK-1',
            provider_refund_id: 202,
          },
          {
            created_at: '2026-09-20T00:00:01Z',
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
    // The failed watch stays open for the next run even if stale.
    expect(writeChain.in as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'id',
      ['watch-2']
    );
    // ...but rotates behind the backlog so one bad batch cannot pin
    // the bounded sweep.
    expect(writeChain.update as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
      updated_at: expect.any(String),
    });
    expect(writeChain.in as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'id',
      ['watch-1']
    );
  });

  it('orders the sweep by least-recently-touched watch', async () => {
    const { selectChain, supabase } = database({
      watches: { data: [], error: null },
    });

    await sweepPaystackRefundRecoveryWatches(supabase);

    expect(selectChain.order as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'updated_at',
      { ascending: true }
    );
  });

  it('keeps the summary when the rotation bump fails', async () => {
    mocks.recover.mockRejectedValue(new Error('provider down'));
    const { supabase } = database({
      watches: {
        data: [
          {
            created_at: '2026-09-20T00:00:00Z',
            id: 'watch-1',
            paystack_ref: 'PSK-1',
            provider_refund_id: 202,
          },
        ],
        error: null,
      },
      writes: { data: null, error: new Error('db down') },
    });

    const summary = await sweepPaystackRefundRecoveryWatches(supabase);

    expect(summary).toEqual({
      checked: 1,
      failed: 1,
      redriven: 0,
      retired: 0,
    });
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Paystack refund recovery watch rotation failed',
      })
    );
  });

  it('skips retirement entirely when nothing was redriven', async () => {
    mocks.recover.mockResolvedValue(undefined);
    const { from, supabase } = database({
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
    expect(from).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({
      checked: 0,
      failed: 0,
      redriven: 0,
      retired: 0,
    });
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
