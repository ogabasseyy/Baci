import { describe, expect, it, vi } from 'vitest';
import { verifyReplayTransactionBinding } from './vtu-replay-binding';

const KEY_ROW = {
  key: 'key-1',
  vtu_transaction_id: 'vtu-1',
  customer_id: 'customer-1',
  merchant_id: 'merchant-1',
  request_fingerprint: 'fp-1',
};

function buildSupabase(responses: Record<string, unknown>) {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve(responses[table] ?? { data: null, error: null })
          ),
        })),
      })),
    })),
  } as never;
}

describe('verifyReplayTransactionBinding', () => {
  it('binds a transaction row owned by the key owner', async () => {
    const supabase = buildSupabase({
      vtu_transactions: {
        data: {
          id: 'vtu-1',
          customer_id: 'customer-1',
          merchant_id: 'merchant-1',
          status: 'processing',
        },
        error: null,
      },
    });

    await expect(
      verifyReplayTransactionBinding({ supabase, keyRow: KEY_ROW })
    ).resolves.toEqual({
      bound: {
        id: 'vtu-1',
        customer_id: 'customer-1',
        merchant_id: 'merchant-1',
        status: 'processing',
      },
    });
  });

  it('returns a terminal message when the transaction row is missing', async () => {
    const supabase = buildSupabase({
      vtu_transactions: { data: null, error: null },
    });

    await expect(
      verifyReplayTransactionBinding({ supabase, keyRow: KEY_ROW })
    ).resolves.toEqual({
      error: expect.stringMatching(/no longer exists/i),
    });
  });

  it.each([
    ['customer', { customer_id: 'OTHER-CUSTOMER', merchant_id: 'merchant-1' }],
    ['merchant', { customer_id: 'customer-1', merchant_id: 'merchant-OTHER' }],
  ])('rejects a %s mismatch without fulfilling', async (_label, owner) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const supabase = buildSupabase({
        vtu_transactions: {
          data: { id: 'vtu-1', status: 'processing', ...owner },
          error: null,
        },
      });

      await expect(
        verifyReplayTransactionBinding({ supabase, keyRow: KEY_ROW })
      ).resolves.toEqual({
        error: 'Idempotency-Key does not belong to this purchase.',
      });
      // The key itself never appears in the mismatch log: only the
      // transaction id and the two owner pairs.
      expect(errorSpy).toHaveBeenCalledWith(
        'Idempotency-Key transaction owner mismatch:',
        expect.objectContaining({ transactionId: 'vtu-1' })
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('throws fail-closed on a lookup error', async () => {
    const supabase = buildSupabase({
      vtu_transactions: { data: null, error: { message: 'boom' } },
    });

    await expect(
      verifyReplayTransactionBinding({ supabase, keyRow: KEY_ROW })
    ).rejects.toThrow(/Failed to look up replay transaction/);
  });
});
