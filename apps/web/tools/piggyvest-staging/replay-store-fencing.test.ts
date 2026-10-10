import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createDurableReplayAdapters, type StoreRpc } from './replay-store';

describe('replay store lost lease regression', () => {
  const store: StoreRpc = {
    async call<T>(): Promise<T> {
      return false as T;
    },
  };
  const adapters = createDurableReplayAdapters({
    store,
    app: {} as SupabaseClient,
    keyResolver: async () => null,
    leaseSeconds: 300,
  });

  it('rejects a false resolve result instead of reporting successful processing', async () => {
    await expect(
      adapters.resolve({
        receiptId: 'synthetic-receipt',
        claimToken: 'expired-token',
        status: 'processed',
        reason: 'applied',
      })
    ).rejects.toThrow('Replay lease transition refused');
  });

  it('rejects a false quarantine result instead of reporting successful quarantine', async () => {
    await expect(
      adapters.quarantine({
        receiptId: 'synthetic-receipt',
        eventId: 'synthetic-event',
        claimToken: 'expired-token',
        reason: 'ambiguous',
      })
    ).rejects.toThrow('Replay lease transition refused');
  });
});
