import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { decryptAndValidateReceipt } from './replay-crypto';
import { createDurableReplayAdapters, type StoreRpc } from './replay-store';
import { event, key, lease } from './replay-test-fixtures';
import { createReplayWorker } from './replay-worker';

it('learns the event identity from authenticated bytes when storage has no plaintext event id', () => {
  const receipt = lease();
  expect(
    decryptAndValidateReceipt(receipt.sealed, key, null).event.eventId
  ).toBe(receipt.eventId);
});

it('still refuses a wrong explicit identity', () => {
  expect(() =>
    decryptAndValidateReceipt(lease().sealed, key, 'other-event')
  ).toThrow('event-id-mismatch');
});

it('accounts for an authenticated unsupported event without crediting or hiding it', async () => {
  const sealed = lease({ ...event, eventType: 'synthetic.verification' });
  const call = vi.fn(async (name: string) =>
    name === 'claim_piggyvest_staging_receipts'
      ? [
          {
            receipt_id: sealed.receiptId,
            payload_sha256: sealed.sealed.payloadSha256,
            ciphertext: sealed.sealed.ciphertext,
            nonce: sealed.sealed.nonce,
            auth_tag: sealed.sealed.authTag,
            key_version: 'staging-v1',
            claim_token: sealed.claimToken,
            attempts: 1,
          },
        ]
      : true
  );
  const appRpc = vi.fn();
  const adapters = createDurableReplayAdapters({
    store: { call: call as StoreRpc['call'] },
    app: { rpc: appRpc } as unknown as SupabaseClient,
    keyResolver: async () => key,
    leaseSeconds: 300,
  });
  const worker = createReplayWorker(adapters, {
    environment: 'staging',
    batchSize: 10,
    keyResolver: async () => key,
  });
  await expect(worker.run()).resolves.toEqual({
    claimed: 1,
    processed: 0,
    quarantined: 1,
    retryable: 0,
    resolutionFailures: 0,
  });
  expect(appRpc).not.toHaveBeenCalled();
  expect(call).toHaveBeenCalledWith(
    'quarantine_piggyvest_staging_receipt',
    expect.objectContaining({ p_reason: 'unsupported-event' })
  );
});
