import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { isConfirmedLocalAirportReplay } from './is-confirmed-local-airport-replay';

const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174000';

describe('isConfirmedLocalAirportReplay', () => {
  it('returns the database replay decision for a keyed request', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    } as unknown as SupabaseClient;

    await expect(
      isConfirmedLocalAirportReplay({
        merchantId: MERCHANT_ID,
        requestIdempotencyKey: 'airport-retry-key',
        supabase,
      })
    ).resolves.toBe(true);
  });

  it('fails closed when the replay probe errors', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: new Error('probe failed'),
      }),
    } as unknown as SupabaseClient;

    await expect(
      isConfirmedLocalAirportReplay({
        merchantId: MERCHANT_ID,
        requestIdempotencyKey: 'airport-retry-key',
        supabase,
      })
    ).resolves.toBe(false);
  });
});
