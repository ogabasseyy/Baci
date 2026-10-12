import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { overlayReplayCustomerPhone } from './vtu-replay-phone-overlay';

type RowState = {
  metadata: Record<string, unknown> | null;
  updateCalls: Record<string, unknown>[];
};

function buildSupabase(state: RowState): SupabaseClient {
  return {
    from: vi.fn((table: string) => {
      if (table !== 'vtu_transactions') {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { metadata: state.metadata },
              error: null,
            }),
          })),
        })),
        update: vi.fn((patch: { metadata: Record<string, unknown> }) => ({
          eq: vi.fn(() => {
            state.updateCalls.push(patch.metadata);
            state.metadata = patch.metadata;
            return Promise.resolve({ data: null, error: null });
          }),
        })),
      };
    }),
  } as unknown as SupabaseClient;
}

describe('overlayReplayCustomerPhone', () => {
  let state: RowState;

  beforeEach(() => {
    state = { metadata: { customerPhone: '08011111111' }, updateCalls: [] };
  });

  it('no-ops (no SELECT) when the request omits the phone', async () => {
    const supabase = buildSupabase(state);
    const result = await overlayReplayCustomerPhone({
      supabase,
      transactionId: 'vtu-tx-1',
      customerPhone: undefined,
    });
    expect(result).toEqual({ updated: false });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('no-ops (no UPDATE) when the request phone matches stored', async () => {
    const result = await overlayReplayCustomerPhone({
      supabase: buildSupabase(state),
      transactionId: 'vtu-tx-1',
      customerPhone: '08011111111',
    });
    expect(result).toEqual({ updated: false });
    expect(state.updateCalls).toHaveLength(0);
  });

  it('merges a differing valid phone, preserving other metadata keys', async () => {
    state.metadata = {
      customerPhone: null,
      originalPhoneNumber: '08099999999',
    };
    const result = await overlayReplayCustomerPhone({
      supabase: buildSupabase(state),
      transactionId: 'vtu-tx-1',
      customerPhone: '+2348012345678',
    });
    expect(result).toEqual({ updated: true });
    expect(state.updateCalls).toEqual([
      {
        customerPhone: '08012345678',
        originalPhoneNumber: '08099999999',
      },
    ]);
  });

  it('throws the prepare-identical message on an invalid phone', async () => {
    await expect(
      overlayReplayCustomerPhone({
        supabase: buildSupabase(state),
        transactionId: 'vtu-tx-1',
        customerPhone: '12345',
      })
    ).rejects.toThrow('Invalid customer phone number');
    expect(state.updateCalls).toHaveLength(0);
  });

  it('treats an unformattable phone as absent, keeping stored', async () => {
    const result = await overlayReplayCustomerPhone({
      supabase: buildSupabase(state),
      transactionId: 'vtu-tx-1',
      customerPhone: '+++',
    });
    expect(result).toEqual({ updated: false });
    expect(state.updateCalls).toHaveLength(0);
  });
});
