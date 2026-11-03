import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discardOrphanedClaimTransaction } from './vtu-claim-orphan-discard';
import { cleanupOrphanVtuTransactionAfterKeyRace } from './vtu-orphan-transaction-cleanup';

vi.mock('./vtu-orphan-transaction-cleanup', () => ({
  cleanupOrphanVtuTransactionAfterKeyRace: vi.fn(),
}));

const cleanup = vi.mocked(cleanupOrphanVtuTransactionAfterKeyRace);
const supabase = {} as SupabaseClient;

describe('discardOrphanedClaimTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the guarded cleanup with the claim context', async () => {
    cleanup.mockResolvedValue('deleted');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    try {
      await discardOrphanedClaimTransaction({
        context: 'join',
        merchantId: 'merch-1',
        supabase,
        transactionId: 'txn-1',
        userId: 'user-1',
      });
    } finally {
      consoleError.mockRestore();
    }

    expect(cleanup).toHaveBeenCalledWith({
      merchantId: 'merch-1',
      supabase,
      transactionId: 'txn-1',
      userId: 'user-1',
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('logs an unresolved outcome with its path context', async () => {
    cleanup.mockResolvedValue('unresolved');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    try {
      await discardOrphanedClaimTransaction({
        context: 'rejection',
        merchantId: 'merch-1',
        supabase,
        transactionId: 'txn-9',
        userId: 'user-1',
      });

      expect(consoleError).toHaveBeenCalledWith(
        expect.stringMatching(/unresolved/),
        { context: 'rejection', transactionId: 'txn-9' }
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('always resolves so cleanup never masks the claim response', async () => {
    cleanup.mockResolvedValue('owned_elsewhere');

    await expect(
      discardOrphanedClaimTransaction({
        context: 'join',
        merchantId: 'merch-1',
        supabase,
        transactionId: 'txn-2',
        userId: 'user-1',
      })
    ).resolves.toBeUndefined();
  });
});
