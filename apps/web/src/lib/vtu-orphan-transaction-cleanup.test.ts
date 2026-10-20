import { describe, expect, it, vi } from 'vitest';
import { cleanupOrphanVtuTransactionAfterKeyRace } from './vtu-orphan-transaction-cleanup';

describe('cleanupOrphanVtuTransactionAfterKeyRace', () => {
  function createSupabase(
    rpcImpl: () => { data: string | null; error: { message: string } | null }
  ) {
    const rpc = vi.fn(() => Promise.resolve(rpcImpl()));
    return { rpc, supabase: { rpc } };
  }

  function cleanup(supabase: { rpc: unknown }) {
    return cleanupOrphanVtuTransactionAfterKeyRace({
      merchantId: 'merchant-1',
      supabase: supabase as never,
      transactionId: 'vtu-orphan',
      userId: 'user-1',
    });
  }

  it('passes ownership scope to the RPC', async () => {
    const { rpc, supabase } = createSupabase(() => ({
      data: 'deleted',
      error: null,
    }));

    await cleanup(supabase);

    expect(rpc).toHaveBeenCalledWith('fail_orphan_vtu_transaction', {
      p_transaction_id: 'vtu-orphan',
      p_merchant_id: 'merchant-1',
      p_user_id: 'user-1',
    });
  });

  it.each([
    'deleted',
    'marked_failed',
  ] as const)('returns %s terminally', async (verdict) => {
    const { rpc, supabase } = createSupabase(() => ({
      data: verdict,
      error: null,
    }));

    const outcome = await cleanup(supabase);

    expect(outcome).toBe(verdict);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('leaves an owned_elsewhere row to its owner without retrying', async () => {
    // The row progressed under the key race — claimed or settled
    // by a worker this orphan should never have met.
    const { rpc, supabase } = createSupabase(() => ({
      data: 'owned_elsewhere',
      error: null,
    }));

    const outcome = await cleanup(supabase);

    expect(outcome).toBe('owned_elsewhere');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('returns unresolved terminally on a deterministic CAS loss', async () => {
    // The row provably left pending mid-mark; retrying re-observes
    // the same state, so no retry (existing unresolved contract).
    const { rpc, supabase } = createSupabase(() => ({
      data: 'unresolved',
      error: null,
    }));

    const outcome = await cleanup(supabase);

    expect(outcome).toBe('unresolved');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('retries a transient RPC error instead of stranding the orphan', async () => {
    // Codex R108 P2: a blip must not abandon a pending orphan no
    // reconciler can discover. The RPC is idempotent, so retries
    // are safe.
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'blip' } })
      .mockResolvedValue({ data: 'deleted', error: null });

    const outcome = await cleanup({ rpc });

    expect(outcome).toBe('deleted');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting retries under sustained outage', async () => {
    const { rpc, supabase } = createSupabase(() => ({
      data: null,
      error: { message: 'db down' },
    }));

    const outcome = await cleanup(supabase);

    expect(outcome).toBe('unresolved');
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it('retries an unknown verdict instead of trusting it', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: 'mangled', error: null })
      .mockResolvedValue({ data: 'deleted', error: null });

    const outcome = await cleanup({ rpc });

    expect(outcome).toBe('deleted');
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
