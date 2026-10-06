import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { createDurableReplayAdapters } from './replay-store';
import { event } from './replay-test-fixtures';

it('dispatches recognition to the app database rather than receipt storage', async () => {
  const receiptCall = vi.fn().mockRejectedValue(new Error('Wrong database'));
  const appRpc = vi.fn().mockResolvedValue({ data: 'recognized', error: null });
  const adapters = createDurableReplayAdapters({
    store: { call: receiptCall },
    app: { rpc: appRpc } as unknown as SupabaseClient,
    keyResolver: async () => null,
    leaseSeconds: 300,
  });
  await expect(
    adapters.dispatch({ event } as Parameters<typeof adapters.dispatch>[0])
  ).resolves.toBe('applied');
  expect(receiptCall).not.toHaveBeenCalled();
  expect(appRpc).toHaveBeenCalledWith(
    'recognize_piggyvest_staging_inflow',
    expect.any(Object)
  );
});
