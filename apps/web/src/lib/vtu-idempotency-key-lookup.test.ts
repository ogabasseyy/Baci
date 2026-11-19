import { describe, expect, it, vi } from 'vitest';
import { lookupVtuIdempotencyVerdict } from './vtu-idempotency-key-lookup';

const KEY_ROW = {
  key: 'key-1',
  vtu_transaction_id: 'vtu-1',
  customer_id: 'customer-1',
  merchant_id: 'merchant-1',
  request_fingerprint: 'fp-1',
};

function buildSupabase(rpcImpl: (fn: string) => unknown) {
  return {
    rpc: vi.fn((fn: string) => Promise.resolve(rpcImpl(fn))),
  } as never;
}

describe('lookupVtuIdempotencyVerdict', () => {
  it('returns the owned row on an owned verdict', async () => {
    const rpc = vi.fn(() =>
      Promise.resolve({
        data: [{ verdict: 'owned', ...KEY_ROW }],
        error: null,
      })
    );
    const supabase = { rpc } as never;

    const lookup = await lookupVtuIdempotencyVerdict(
      supabase,
      'key-1',
      'user-1'
    );

    expect(lookup).toEqual({ verdict: 'owned', row: KEY_ROW });
    expect(rpc).toHaveBeenCalledWith('lookup_vtu_idempotency_row', {
      p_key: 'key-1',
      p_user_id: 'user-1',
    });
  });

  it('returns a row-less fresh verdict for unmapped keys', async () => {
    const supabase = buildSupabase(() => ({
      data: [
        {
          verdict: 'fresh',
          key: 'key-9',
          vtu_transaction_id: null,
          customer_id: null,
          merchant_id: null,
          request_fingerprint: null,
        },
      ],
      error: null,
    }));

    await expect(
      lookupVtuIdempotencyVerdict(supabase, 'key-9', 'user-1')
    ).resolves.toEqual({ verdict: 'fresh', row: null });
  });

  it('returns a row-less foreign verdict without leaking fields', async () => {
    // Even if the RPC ever returned fields on foreign (a server bug),
    // the wrapper must not surface them.
    const supabase = buildSupabase(() => ({
      data: [{ verdict: 'foreign', ...KEY_ROW }],
      error: null,
    }));

    await expect(
      lookupVtuIdempotencyVerdict(supabase, 'key-1', 'user-1')
    ).resolves.toEqual({ verdict: 'foreign', row: null });
  });

  it('throws fail-closed on a lookup error', async () => {
    const supabase = buildSupabase(() => ({
      data: null,
      error: { message: 'boom' },
    }));

    await expect(
      lookupVtuIdempotencyVerdict(supabase, 'key-1', 'user-1')
    ).rejects.toThrow(/Failed to look up idempotency key/);
  });

  it('throws on a missing or invalid verdict', async () => {
    const empty = buildSupabase(() => ({ data: [], error: null }));
    await expect(
      lookupVtuIdempotencyVerdict(empty, 'key-1', 'user-1')
    ).rejects.toThrow(/invalid verdict/);

    const bogus = buildSupabase(() => ({
      data: [{ verdict: 'maybe', ...KEY_ROW }],
      error: null,
    }));
    await expect(
      lookupVtuIdempotencyVerdict(bogus, 'key-1', 'user-1')
    ).rejects.toThrow(/invalid verdict/);
  });

  it('throws on an incomplete owned row', async () => {
    const supabase = buildSupabase(() => ({
      data: [{ verdict: 'owned', ...KEY_ROW, customer_id: null }],
      error: null,
    }));

    await expect(
      lookupVtuIdempotencyVerdict(supabase, 'key-1', 'user-1')
    ).rejects.toThrow(/owned row incomplete/);
  });
});
