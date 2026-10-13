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
  status: unknown;
} | null;

function buildSupabase(calls: RpcCall[], row: VtuRow): SupabaseClient {
  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    // The ownership-scoped refresh read is tracked separately from
    // the patch RPC: existing assertions pin the patch call shape.
    if (fn === 'get_vtu_replay_refresh_fields') {
      return {
        maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
      };
    }
    calls.push({ fn, args });
    return Promise.resolve({ data: null, error: null });
  });
  return {
    from: vi.fn(() => {
      throw new Error(
        'overlay must not query vtu_transactions directly (use the scoped RPC)'
      );
    }),
    rpc,
  } as unknown as SupabaseClient;
}

function monnifyRow(
  overrides: Record<string, unknown> = {},
  status: unknown = 'pending'
): VtuRow {
  return {
    metadata: {
      provider: 'monnify',
      requireValidationRef: true,
      billerCode: 'BILLER',
      productCode: 'PRODUCT',
      ...overrides,
    },
    customer_identifier: '1234567890',
    status,
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

  it('skips refresh for rows that will not re-vend', async () => {
    // Successful rows short-circuit, processing rows requery by
    // provider reference, failed rows take the refund path: none
    // consume a reference, so no 30s validation call is warranted.
    for (const status of ['successful', 'processing', 'failed']) {
      const result = await overlayReplayAttributes({
        supabase: buildSupabase(calls, monnifyRow({}, status)),
        transactionId: 'vtu-tx-1',
        customerPhone: undefined,
        validationReference: undefined,
      });
      expect(result).toEqual({ updated: false, refreshed: false });
    }
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

  it('ignores an invalid phone and still overlays the reference', async () => {
    // Invalid replay phone ≡ omitted: the row already carries
    // attempt-1-validated state, so degrade instead of 400ing the
    // replay (which would rotate the clients' key and double-debit).
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await overlayReplayAttributes({
        supabase: buildSupabase(calls, monnifyRow()),
        transactionId: 'vtu-tx-1',
        customerPhone: '12345',
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
      expect(warn).toHaveBeenCalledTimes(1);
      expect(mockVerifyBillCustomer).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('reads refresh fields through the ownership-scoped RPC, never the table', async () => {
    // Codex R50 6rp7ND: no SELECT policy exposes customer rows, so
    // the pre-read goes through get_vtu_replay_refresh_fields (three
    // columns, owner rows only) instead of from().select().
    mockVerifyBillCustomer.mockResolvedValue({
      message: 'ok',
      validationReference: 'VAL-REFRESHED',
      verified: true,
    });
    const supabase = buildSupabase(calls, monnifyRow());

    const result = await overlayReplayAttributes({
      customerPhone: undefined,
      supabase,
      transactionId: 'vtu-tx-1',
      validationReference: undefined,
    });

    expect(supabase.rpc).toHaveBeenCalledWith('get_vtu_replay_refresh_fields', {
      p_transaction_id: 'vtu-tx-1',
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(result).toEqual({ refreshed: true, updated: true });
    expect(calls).toEqual([
      {
        args: {
          p_customer_phone: null,
          p_transaction_id: 'vtu-tx-1',
          p_validation_reference: 'VAL-REFRESHED',
        },
        fn: 'set_vtu_transaction_replay_attributes',
      },
    ]);
  });

  it('wraps RPC failures without leaking them to the client contract', async () => {
    const supabase = {
      rpc: vi.fn((fn: string) => {
        if (fn === 'get_vtu_replay_refresh_fields') {
          return {
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return Promise.resolve({ data: null, error: { message: 'P0002' } });
      }),
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
