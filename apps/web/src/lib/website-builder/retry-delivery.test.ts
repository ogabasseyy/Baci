import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import {
  retryCommittedDelivery,
  runOwnerPublicationOutbox,
} from './retry-delivery';

it('reserves exhausted-cycle recovery for an explicit owner retry, never automatic work', async () => {
  const id = '20000000-0000-4000-8000-000000000001';
  const result = {
    storefrontId: id,
    version: `draft:${id}`,
    receiptId: id,
    publishedVersion: `published:${id}`,
    status: 'verifying',
  };
  const rpc = vi.fn(async (name: string) => ({
    data: name === 'builder_due_publications' ? [id] : { result },
    error: null,
  }));
  const client = { rpc } as unknown as SupabaseClient;
  const deps = { evict: vi.fn(), probe: vi.fn(), certifyDelivery: vi.fn() };
  expect(await runOwnerPublicationOutbox(client, deps)).toEqual([result]);
  expect(rpc).toHaveBeenCalledWith('builder_claim_publication_delivery', {
    p_receipt: id,
  });
  expect(rpc).not.toHaveBeenCalledWith(
    'builder_retry_publication_delivery',
    expect.anything()
  );
  rpc.mockClear();
  expect(await retryCommittedDelivery(client, id, deps, true)).toEqual(result);
  expect(rpc).toHaveBeenCalledWith('builder_retry_publication_delivery', {
    p_receipt: id,
  });
  expect(deps.probe).not.toHaveBeenCalled();
});
