import { describe, expect, it, vi } from 'vitest';
import { findExistingIdempotencyRow } from './vtu-idempotency-key-lookup';

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

describe('findExistingIdempotencyRow', () => {
  it('returns the key row on a hit', async () => {
    const supabase = buildSupabase({
      vtu_idempotency_keys: { data: KEY_ROW, error: null },
    });

    await expect(
      findExistingIdempotencyRow(supabase, 'key-1')
    ).resolves.toEqual(KEY_ROW);
  });

  it('returns null on a miss', async () => {
    const supabase = buildSupabase({
      vtu_idempotency_keys: { data: null, error: null },
    });

    await expect(
      findExistingIdempotencyRow(supabase, 'key-1')
    ).resolves.toBeNull();
  });

  it('throws fail-closed on a lookup error', async () => {
    const supabase = buildSupabase({
      vtu_idempotency_keys: { data: null, error: { message: 'boom' } },
    });

    await expect(findExistingIdempotencyRow(supabase, 'key-1')).rejects.toThrow(
      /Failed to look up idempotency key/
    );
  });
});
