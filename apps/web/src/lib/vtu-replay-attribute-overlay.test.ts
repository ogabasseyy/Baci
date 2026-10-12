import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { overlayReplayAttributes } from './vtu-replay-attribute-overlay';

type RpcCall = {
  fn: string;
  args: Record<string, unknown>;
};

function buildSupabase(calls: RpcCall[]): SupabaseClient {
  return {
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    }),
  } as unknown as SupabaseClient;
}

describe('overlayReplayAttributes', () => {
  let calls: RpcCall[];

  beforeEach(() => {
    calls = [];
  });

  it('no-ops (no RPC) when the request carries neither attribute', async () => {
    const result = await overlayReplayAttributes({
      supabase: buildSupabase(calls),
      transactionId: 'vtu-tx-1',
      customerPhone: undefined,
      validationReference: undefined,
    });
    expect(result).toEqual({ updated: false });
    expect(calls).toHaveLength(0);
  });

  it('treats blank values as absent', async () => {
    const result = await overlayReplayAttributes({
      supabase: buildSupabase(calls),
      transactionId: 'vtu-tx-1',
      customerPhone: '+++',
      validationReference: '   ',
    });
    expect(result).toEqual({ updated: false });
    expect(calls).toHaveLength(0);
  });

  it('patches both attributes atomically in one RPC call', async () => {
    const result = await overlayReplayAttributes({
      supabase: buildSupabase(calls),
      transactionId: 'vtu-tx-1',
      customerPhone: '+2348012345678',
      validationReference: 'VRF-9',
    });
    expect(result).toEqual({ updated: true });
    expect(calls).toEqual([
      {
        fn: 'set_vtu_transaction_replay_attributes',
        args: {
          p_transaction_id: 'vtu-tx-1',
          p_customer_phone: '08012345678',
          p_validation_reference: 'VRF-9',
        },
      },
    ]);
  });

  it('patches a lone reference (phone omitted, e.g. mobile)', async () => {
    const result = await overlayReplayAttributes({
      supabase: buildSupabase(calls),
      transactionId: 'vtu-tx-1',
      customerPhone: undefined,
      validationReference: 'VRF-9',
    });
    expect(result).toEqual({ updated: true });
    expect(calls).toEqual([
      {
        fn: 'set_vtu_transaction_replay_attributes',
        args: {
          p_transaction_id: 'vtu-tx-1',
          p_customer_phone: null,
          p_validation_reference: 'VRF-9',
        },
      },
    ]);
  });

  it('throws the prepare-identical message on an invalid phone', async () => {
    await expect(
      overlayReplayAttributes({
        supabase: buildSupabase(calls),
        transactionId: 'vtu-tx-1',
        customerPhone: '12345',
        validationReference: 'VRF-9',
      })
    ).rejects.toThrow('Invalid customer phone number');
    expect(calls).toHaveLength(0);
  });

  it('wraps RPC failures without leaking them to the client contract', async () => {
    const supabase = {
      rpc: vi.fn(() =>
        Promise.resolve({ data: null, error: { message: 'P0002' } })
      ),
    } as unknown as SupabaseClient;
    await expect(
      overlayReplayAttributes({
        supabase,
        transactionId: 'vtu-tx-1',
        customerPhone: '08012345678',
        validationReference: undefined,
      })
    ).rejects.toThrow('Failed to overlay replay attributes');
  });
});
