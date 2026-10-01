import { beforeEach, describe, expect, it, vi } from 'vitest';
import { removeUploadedReplacement } from './expense-save-cleanup';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mocks.rpc(...args),
  },
}));

describe('removeUploadedReplacement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ error: null });
  });

  it('throws when pre-write receipt queueing fails', async () => {
    const { queueUploadedReceiptForCleanup } = await import(
      './expense-save-cleanup'
    );

    mocks.rpc.mockResolvedValue({
      error: { message: 'queue unavailable' },
    });

    await expect(
      queueUploadedReceiptForCleanup('merchant-1', 'path.jpg')
    ).rejects.toThrow('queue unavailable');
  });

  it('queues uploaded receipts before cleanup helper', async () => {
    const { queueUploadedReceiptForCleanup } = await import(
      './expense-save-cleanup'
    );

    await queueUploadedReceiptForCleanup('merchant-1', 'path.jpg');

    expect(mocks.rpc).toHaveBeenCalledWith(
      'queue_unreferenced_expense_private_receipt_cleanup',
      {
        p_merchant_id: 'merchant-1',
        p_storage_path: 'path.jpg',
      }
    );
  });

  it('removes an uploaded path and tolerates cleanup failure', async () => {
    const removeOwned = vi.fn().mockRejectedValue(new Error('storage offline'));

    await expect(
      removeUploadedReplacement({ removeOwned }, 'merchant-1', 'path.jpg')
    ).resolves.toBeUndefined();
    expect(removeOwned).toHaveBeenCalledWith('merchant-1', 'path.jpg');
    expect(mocks.rpc).toHaveBeenCalledWith(
      'queue_unreferenced_expense_private_receipt_cleanup',
      {
        p_merchant_id: 'merchant-1',
        p_storage_path: 'path.jpg',
      }
    );
  });

  it('queues edit-scoped cleanup when storage removal fails during an edit rejection', async () => {
    const removeOwned = vi.fn().mockRejectedValue(new Error('storage offline'));

    await removeUploadedReplacement({ removeOwned }, 'merchant-1', 'path.jpg', {
      expenseId: 'expense-1',
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      'queue_expense_private_receipt_cleanup',
      {
        p_expense_id: 'expense-1',
        p_merchant_id: 'merchant-1',
        p_storage_path: 'path.jpg',
      }
    );
  });

  it('does not call storage for an absent path', async () => {
    const removeOwned = vi.fn();

    await removeUploadedReplacement({ removeOwned }, 'merchant-1', null);

    expect(removeOwned).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
