import { describe, expect, it, vi } from 'vitest';
import { restoreInterruptedPreVendVtuRow } from './vtu-pre-vend-recovery';

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
    const { supabase } = createSupabase({ message: 'write failed' });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(
        restoreInterruptedPreVendVtuRow({
          errorMessage: 'boom',
          row: { id: 'vtu-1' },
          supabase: supabase as never,
        })
      ).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to restore interrupted pre-vend VTU row:',
        expect.objectContaining({ transactionId: 'vtu-1' })
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
