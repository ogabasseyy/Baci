import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { overlayReplayAttributes } from './vtu-replay-attribute-overlay';

const { mockVerifyBillCustomer } = vi.hoisted(() => ({
  mockVerifyBillCustomer: vi.fn(),
}));

vi.mock('@/lib/monnify-bills', () => ({
  verifyBillCustomer: mockVerifyBillCustomer,
}));

type RpcCall = {
  fn: string;
  args: Record<string, unknown>;
};

type VtuRow = {
  metadata: unknown;
  customer_identifier: unknown;
} | null;

function buildSupabase(calls: RpcCall[], row: VtuRow): SupabaseClient {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: row, error: null }),
        })),
      })),
    })),
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    }),
  } as unknown as SupabaseClient;
}

function monnifyRow(overrides: Record<string, unknown> = {}): VtuRow {
  return {
    metadata: {
      provider: 'monnify',
      requireValidationRef: true,
      billerCode: 'BILLER',
      productCode: 'PRODUCT',
      ...overrides,
    },
    customer_identifier: '1234567890',
  };
}

describe('overlayReplayAttributes', () => {
  let calls: RpcCall[];

  beforeEach(() => {
    calls = [];
    mockVerifyBillCustomer.mockReset();
  });

  it('no-ops when the request carries neither attribute and the row needs no refresh', async () => {
    const result = await overlayReplayAttributes({
      supabase: buildSupabase(calls, null),
      transactionId: 'vtu-tx-1',
      customerPhone: undefined,
      validationReference: undefined,
    });
    expect(result).toEqual({ updated: false, refreshed: false });
    expect(calls).toHaveLength(0);
    expect(mockVerifyBillCustomer).not.toHaveBeenCalled();
  });

  it('treats blank values as absent', async () => {
    const result = await overlayReplayAttributes({
      supabase: buildSupabase(calls, null),
      transactionId: 'vtu-tx-1',
      customerPhone: '+++',
      validationReference: '   ',
    });
    expect(result).toEqual({ updated: false, refreshed: false });
    expect(calls).toHaveLength(0);
  });

  it('patches both attributes atomically in one RPC call', async () => {
    const result = await overlayReplayAttributes({
      supabase: buildSupabase(calls, monnifyRow()),
      transactionId: 'vtu-tx-1',
      customerPhone: '+2348012345678',
      validationReference: 'VRF-9',
    });
    expect(result).toEqual({ updated: true, refreshed: false });
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
    // A request-supplied reference always wins: no server refresh.
    expect(mockVerifyBillCustomer).not.toHaveBeenCalled();
  });

  it('patches a lone reference (phone omitted, e.g. mobile)', async () => {
    const result = await overlayReplayAttributes({
      supabase: buildSupabase(calls, monnifyRow()),
      transactionId: 'vtu-tx-1',
      customerPhone: undefined,
      validationReference: 'VRF-9',
    });
    expect(result).toEqual({ updated: true, refreshed: false });
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

  it('server-refreshes an omitted reference for Monnify rows requiring one', async () => {
    mockVerifyBillCustomer.mockResolvedValue({
      verified: true,
      validationReference: 'VRF-FRESH',
      message: 'ok',
    });
    const result = await overlayReplayAttributes({
      supabase: buildSupabase(calls, monnifyRow()),
      transactionId: 'vtu-tx-1',
      customerPhone: undefined,
      validationReference: undefined,
    });
    expect(mockVerifyBillCustomer).toHaveBeenCalledWith(
      'BILLER',
      'PRODUCT',
      '1234567890'
    );
    expect(result).toEqual({ updated: true, refreshed: true });
    expect(calls).toEqual([
      {
        fn: 'set_vtu_transaction_replay_attributes',
        args: {
          p_transaction_id: 'vtu-tx-1',
          p_customer_phone: null,
          p_validation_reference: 'VRF-FRESH',
        },
      },
    ]);
  });

  it('combines a request phone with a server-refreshed reference in one RPC', async () => {
    mockVerifyBillCustomer.mockResolvedValue({
      verified: true,
      validationReference: 'VRF-FRESH',
      message: 'ok',
    });
    const result = await overlayReplayAttributes({
      supabase: buildSupabase(calls, monnifyRow()),
      transactionId: 'vtu-tx-1',
      customerPhone: '08012345678',
      validationReference: undefined,
    });
    expect(result).toEqual({ updated: true, refreshed: true });
    expect(calls).toEqual([
      {
        fn: 'set_vtu_transaction_replay_attributes',
        args: {
          p_transaction_id: 'vtu-tx-1',
          p_customer_phone: '08012345678',
          p_validation_reference: 'VRF-FRESH',
        },
      },
    ]);
  });

  it('skips refresh for non-Monnify rows', async () => {
    const result = await overlayReplayAttributes({
      supabase: buildSupabase(
        calls,
        monnifyRow({ provider: 'kuda', requireValidationRef: false })
      ),
      transactionId: 'vtu-tx-1',
      customerPhone: undefined,
      validationReference: undefined,
    });
    expect(result).toEqual({ updated: false, refreshed: false });
    expect(calls).toHaveLength(0);
    expect(mockVerifyBillCustomer).not.toHaveBeenCalled();
  });

  it('skips refresh when the row needs no reference', async () => {
    const result = await overlayReplayAttributes({
      supabase: buildSupabase(
        calls,
        monnifyRow({ requireValidationRef: false })
      ),
      transactionId: 'vtu-tx-1',
      customerPhone: undefined,
      validationReference: undefined,
    });
    expect(result).toEqual({ updated: false, refreshed: false });
    expect(mockVerifyBillCustomer).not.toHaveBeenCalled();
  });

  it('falls back to stored when re-verification reports unverified', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockVerifyBillCustomer.mockResolvedValue({
        verified: false,
        message: 'meter blocked',
      });
      const result = await overlayReplayAttributes({
        supabase: buildSupabase(calls, monnifyRow()),
        transactionId: 'vtu-tx-1',
        customerPhone: undefined,
        validationReference: undefined,
      });
      expect(result).toEqual({ updated: false, refreshed: false });
      expect(calls).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('falls back to stored when verification throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockVerifyBillCustomer.mockRejectedValue(new Error('provider 5xx'));
      const result = await overlayReplayAttributes({
        supabase: buildSupabase(calls, monnifyRow()),
        transactionId: 'vtu-tx-1',
        customerPhone: undefined,
        validationReference: undefined,
      });
      expect(result).toEqual({ updated: false, refreshed: false });
      expect(calls).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('throws the prepare-identical message on an invalid phone', async () => {
    await expect(
      overlayReplayAttributes({
        supabase: buildSupabase(calls, monnifyRow()),
        transactionId: 'vtu-tx-1',
        customerPhone: '12345',
        validationReference: 'VRF-9',
      })
    ).rejects.toThrow('Invalid customer phone number');
    expect(calls).toHaveLength(0);
    expect(mockVerifyBillCustomer).not.toHaveBeenCalled();
  });

  it('wraps RPC failures without leaking them to the client contract', async () => {
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
      })),
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
