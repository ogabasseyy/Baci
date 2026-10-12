import { describe, expect, it, vi } from 'vitest';
import {
  isStrandedPreVendVtuRow,
  restoreInterruptedPreVendVtuRow,
  STRANDED_PRE_VEND_STALE_MS,
} from './vtu-pre-vend-recovery';

function createSupabase(updateError: { message: string } | null = null) {
  const eq = vi.fn();
  const chain = Object.assign(Promise.resolve({ error: updateError }), {
    eq,
  });
  eq.mockReturnValue(chain);
  const update = vi.fn(() => ({ eq }));
  return {
    eq,
    update,
    supabase: {
      from: vi.fn(() => ({ update })),
    },
  };
}

describe('restoreInterruptedPreVendVtuRow', () => {
  it('flips the claimed row back to marked pending', async () => {
    const { eq, supabase, update } = createSupabase();

    await restoreInterruptedPreVendVtuRow({
      errorMessage: 'Failed to debit VTU wallet for vtu-1: boom',
      row: { id: 'vtu-1', metadata: { paymentSplit: { wallet: 300 } } },
      supabase: supabase as never,
    });

    expect(supabase.from).toHaveBeenCalledWith('vtu_transactions');
    expect(update).toHaveBeenCalledWith({
      error_message: 'Failed to debit VTU wallet for vtu-1: boom',
      metadata: expect.objectContaining({
        paymentSplit: { wallet: 300 },
        preVendInterruptedAt: expect.any(String),
      }),
      status: 'pending',
    });
    expect(eq).toHaveBeenCalledWith('id', 'vtu-1');
    expect(eq).toHaveBeenCalledWith('status', 'processing');
  });

  it('logs (does not throw) when the restore write itself fails', async () => {
    const { supabase, update } = createSupabase({ message: 'write failed' });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(
        restoreInterruptedPreVendVtuRow({
          errorMessage: 'boom',
          row: { id: 'vtu-1' },
          supabase: supabase as never,
        })
      ).resolves.toBeUndefined();
      // Bounded retry: the restore usually fails on the same transient
      // blip as the write it follows, so all three attempts run before
      // giving up to the reconciler's stranded-row recovery.
      expect(update).toHaveBeenCalledTimes(3);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to restore interrupted pre-vend VTU row:',
        expect.objectContaining({ attempts: 3, transactionId: 'vtu-1' })
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('recovers when a retry attempt succeeds', async () => {
    const fail = Object.assign(
      Promise.resolve({ error: { message: 'blip' } }),
      { eq: vi.fn() }
    );
    fail.eq.mockReturnValue(fail);
    const succeed = Object.assign(Promise.resolve({ error: null }), {
      eq: vi.fn(),
    });
    succeed.eq.mockReturnValue(succeed);
    const update = vi
      .fn()
      .mockReturnValueOnce({ eq: fail.eq })
      .mockReturnValue({ eq: succeed.eq });
    const supabase = { from: vi.fn(() => ({ update })) };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await restoreInterruptedPreVendVtuRow({
        errorMessage: 'boom',
        row: { id: 'vtu-1' },
        supabase: supabase as never,
      });

      expect(update).toHaveBeenCalledTimes(2);
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe('isStrandedPreVendVtuRow', () => {
  const staleAt = new Date(
    Date.now() - STRANDED_PRE_VEND_STALE_MS - 1000
  ).toISOString();
  const freshAt = new Date(Date.now() - 1000).toISOString();

  it('flags a stale reference-less processing row with no provider evidence', () => {
    expect(
      isStrandedPreVendVtuRow({
        id: 'vtu-1',
        status: 'processing',
        transaction_id: null,
        error_message: null,
        metadata: { walletDebited: true },
        updated_at: staleAt,
      })
    ).toBe(true);
  });

  it('declines rows a live worker could still hold', () => {
    expect(
      isStrandedPreVendVtuRow({
        id: 'vtu-1',
        status: 'processing',
        transaction_id: null,
        error_message: null,
        metadata: {},
        updated_at: freshAt,
      })
    ).toBe(false);
  });

  it('declines rows without a last-write timestamp', () => {
    expect(
      isStrandedPreVendVtuRow({
        id: 'vtu-1',
        status: 'processing',
        transaction_id: null,
        error_message: null,
        metadata: {},
        updated_at: null,
      })
    ).toBe(false);
  });

  it('declines rows with any provider evidence (vend may have landed)', () => {
    const base = {
      id: 'vtu-1',
      status: 'processing' as const,
      updated_at: staleAt,
    };
    expect(
      isStrandedPreVendVtuRow({
        ...base,
        transaction_id: 'PROV-1',
        error_message: null,
        metadata: {},
      })
    ).toBe(false);
    expect(
      isStrandedPreVendVtuRow({
        ...base,
        transaction_id: null,
        error_message: 'provider said maybe',
        metadata: {},
      })
    ).toBe(false);
    expect(
      isStrandedPreVendVtuRow({
        ...base,
        transaction_id: null,
        error_message: null,
        metadata: { monnifyVendReference: 'VEND-1' },
      })
    ).toBe(false);
  });

  it('declines non-processing rows', () => {
    expect(
      isStrandedPreVendVtuRow({
        id: 'vtu-1',
        status: 'pending',
        transaction_id: null,
        error_message: null,
        metadata: {},
        updated_at: staleAt,
      })
    ).toBe(false);
  });
});
