import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { admitVtuClaim } from './vtu-claim-admission';

it('gets both the key verdict and customer-scoped proof on the authenticated client', async () => {
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === 'lookup_vtu_idempotency_row'
        ? [{ verdict: 'fresh' }]
        : [
            {
              admitted_at: '2026-11-01T10:00:00Z',
              live_transaction_ids: ['own-transaction'],
            },
          ],
    error: null,
  }));
  const client = { rpc } as unknown as SupabaseClient;
  const result = await admitVtuClaim(
    client,
    'key',
    'user',
    'store',
    'fingerprint'
  );
  expect(result.proof?.admissionLive).toEqual(['own-transaction']);
  expect(rpc.mock.calls.map(([name]) => name).sort()).toEqual([
    'lookup_vtu_idempotency_row',
    'vtu_admission_proof',
  ]);
});
