import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { fetchPublicSerializedAvailabilityCounts } from './public-serialized-availability-counts';

function rpcQuery(data: unknown, error: unknown) {
  const retry = vi.fn().mockResolvedValue({ data, error });
  const query = { overrideTypes: vi.fn(), retry };
  query.overrideTypes.mockReturnValue(query);
  return query;
}

describe('fetchPublicSerializedAvailabilityCounts', () => {
  it('fails closed without retrying a non-timeout RPC error', async () => {
    const error = new Error('database unavailable');
    const supabase = {
      rpc: vi.fn().mockReturnValue(rpcQuery(null, error)),
    } as unknown as SupabaseClient;

    await expect(
      fetchPublicSerializedAvailabilityCounts(supabase, 'merchant-1', [
        'product-1',
      ])
    ).rejects.toThrow(error);

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('fails closed after its one explicit retry also times out', async () => {
    const timeoutError = { message: 'TimeoutError: request timed out' };
    const supabase = {
      rpc: vi
        .fn()
        .mockReturnValueOnce(rpcQuery(null, timeoutError))
        .mockReturnValueOnce(rpcQuery(null, timeoutError)),
    } as unknown as SupabaseClient;

    await expect(
      fetchPublicSerializedAvailabilityCounts(supabase, 'merchant-1', [
        'product-1',
      ])
    ).rejects.toEqual(timeoutError);

    expect(supabase.rpc).toHaveBeenCalledTimes(2);
  });
});
