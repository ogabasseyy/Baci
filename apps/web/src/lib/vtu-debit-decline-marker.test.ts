import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markVtuWalletDebitDeclined,
  VTU_DEBIT_DECLINED_MARKER_KEY,
} from './vtu-debit-decline-marker';

describe('markVtuWalletDebitDeclined', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function buildSupabase(errors: Array<{ message: string } | null>): {
    rpc: ReturnType<typeof vi.fn>;
    supabase: SupabaseClient;
  } {
    let attempt = 0;
    const rpc = vi.fn(() => {
      const error = errors[Math.min(attempt, errors.length - 1)] ?? null;
      attempt += 1;
      return Promise.resolve({ data: null, error });
    });
    return { rpc, supabase: { rpc } as unknown as SupabaseClient };
  }

  it('stamps the decline marker in one RPC call', async () => {
    const { rpc, supabase } = buildSupabase([null]);
    const declinedAt = new Date('2026-10-12T19:00:00.000Z').toISOString();

    const pending = markVtuWalletDebitDeclined({
      declinedAt,
      supabase,
      transactionId: 'vtu-tx-1',
    });
    await vi.runAllTimersAsync();
    await pending;

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('mark_vtu_wallet_debit_declined', {
      p_declined_at: declinedAt,
      p_transaction_id: 'vtu-tx-1',
    });
    expect(VTU_DEBIT_DECLINED_MARKER_KEY).toBe(
      'walletDebitDeclinedInsufficientBalanceAt'
    );
  });

  it('retries a transient RPC failure, then succeeds', async () => {
    const { rpc, supabase } = buildSupabase([
      { message: 'connection reset' },
      null,
    ]);

    const pending = markVtuWalletDebitDeclined({
      declinedAt: new Date().toISOString(),
      supabase,
      transactionId: 'vtu-tx-1',
    });
    await vi.runAllTimersAsync();
    await pending;

    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('never throws: exhaustion only logs', async () => {
    const { rpc, supabase } = buildSupabase([{ message: 'db down' }]);
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const pending = markVtuWalletDebitDeclined({
      declinedAt: new Date().toISOString(),
      supabase,
      transactionId: 'vtu-tx-1',
    });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledTimes(3);
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to mark VTU wallet debit declined:',
      expect.objectContaining({ transactionId: 'vtu-tx-1' })
    );
  });
});
