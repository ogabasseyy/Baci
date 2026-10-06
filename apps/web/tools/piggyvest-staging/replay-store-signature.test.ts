import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import type { PrefundedReceiptReplay } from './replay-prefunded';
import { createDurableReplayAdapters, type StoreRpc } from './replay-store';
import { key, lease } from './replay-test-fixtures';
import { createReplayWorker } from './replay-worker';

const receiptId = '10000000-0000-4000-8000-000000000001';
const claimToken = '20000000-0000-4000-8000-000000000001';
const signatureRpc = 'read_piggyvest_staging_receipt_signature';

function fixture() {
  const receipt = { ...lease(), receiptId, claimToken };
  const stored = {
    receiptId,
    payloadSha256: receipt.sealed.payloadSha256,
    signature: 'Ab'.repeat(64),
  };
  const read = vi.fn(async (): Promise<unknown> => stored);
  const callMock = vi.fn(
    async (
      name: string,
      _params: Record<string, unknown>
    ): Promise<unknown> => {
      if (name === signatureRpc) return read();
      if (name === 'claim_piggyvest_staging_receipts')
        return [
          {
            receipt_id: receiptId,
            payload_sha256: receipt.sealed.payloadSha256,
            ciphertext: receipt.sealed.ciphertext,
            nonce: receipt.sealed.nonce,
            auth_tag: receipt.sealed.authTag,
            key_version: receipt.sealed.keyVersion,
            claim_token: claimToken,
            attempts: 1,
          },
        ];
      return true;
    }
  );
  const call: StoreRpc['call'] & typeof callMock = Object.assign(
    async <Result>(
      name: string,
      params: Record<string, unknown>
    ): Promise<Result> => (await callMock(name, params)) as Result,
    callMock
  );
  const appRpc = vi.fn();
  const replay = vi.fn<PrefundedReceiptReplay['replay']>(async () => ({
    outcome: 'processed',
    projection: 'duplicate',
  }));
  const prefundedReplay: PrefundedReceiptReplay = {
    resolveEnrollment: async () => 'enrolled',
    replay,
  };
  const build = (
    callbacks: PrefundedReceiptReplay | undefined = prefundedReplay
  ) =>
    createDurableReplayAdapters({
      store: { call },
      app: { rpc: appRpc } as unknown as SupabaseClient,
      prefundedReplay: callbacks,
      leaseSeconds: 300,
      keyResolver: async () => key,
    });
  const run = (callbacks = prefundedReplay) =>
    createReplayWorker(build(callbacks), {
      environment: 'staging',
      batchSize: 1,
      keyResolver: async () => key,
    }).run();
  return {
    receipt,
    stored,
    read,
    call,
    appRpc,
    replay,
    prefundedReplay,
    build,
    run,
  };
}

it('defaults enrolled replay to the receipt store signature RPC before resolving the active claim', async () => {
  const sample = fixture();
  expect(await sample.run()).toMatchObject({ processed: 1, retryable: 0 });
  expect(sample.call).toHaveBeenCalledWith(signatureRpc, {
    p_receipt_id: receiptId,
    p_payload_sha256: sample.receipt.sealed.payloadSha256,
    p_claim_token: claimToken,
  });
  expect(sample.read).toHaveBeenCalledOnce();
  expect(sample.replay).toHaveBeenCalledWith(
    expect.objectContaining({
      signature: sample.stored.signature,
    })
  );
  expect(sample.appRpc).not.toHaveBeenCalled();
  expect(sample.call).toHaveBeenLastCalledWith(
    'resolve_piggyvest_staging_receipt',
    {
      p_receipt_id: receiptId,
      p_claim_token: claimToken,
      p_status: 'processed',
      p_last_error: null,
    }
  );
});

it('does not mutate the caller bundle or read storage while constructing adapters', () => {
  const sample = fixture();
  const result = sample.build();
  expect(sample.prefundedReplay.readOriginalSignature).toBeUndefined();
  expect(result.prefundedReplay?.readOriginalSignature).toEqual(
    expect.any(Function)
  );
  expect(result.prefundedReplay?.replay).toBe(sample.replay);
  expect(sample.call).not.toHaveBeenCalled();
});

it('preserves an explicit signature reader override without invoking the default RPC', async () => {
  const sample = fixture();
  const override = vi.fn(async () => sample.stored);
  const callbacks = {
    ...sample.prefundedReplay,
    readOriginalSignature: override,
  };
  expect(sample.build(callbacks).prefundedReplay?.readOriginalSignature).toBe(
    override
  );
  expect((await sample.run(callbacks)).processed).toBe(1);
  expect(override).toHaveBeenCalledExactlyOnceWith({
    receiptId,
    payloadSha256: sample.stored.payloadSha256,
    claimToken,
  });
  expect(sample.read).not.toHaveBeenCalled();
  expect(sample.call.mock.calls.some(([name]) => name === signatureRpc)).toBe(
    false
  );
});

it('keeps missing or expired signature evidence retryable without falling through to the app database', async () => {
  const sample = fixture();
  sample.read.mockResolvedValue(null);
  expect(await sample.run()).toMatchObject({
    processed: 0,
    retryable: 1,
    quarantined: 0,
  });
  expect(sample.replay).not.toHaveBeenCalled();
  expect(sample.appRpc).not.toHaveBeenCalled();
  expect(sample.call).toHaveBeenLastCalledWith(
    'resolve_piggyvest_staging_receipt',
    {
      p_receipt_id: receiptId,
      p_claim_token: claimToken,
      p_status: 'quarantined',
      p_last_error: 'worker retryable',
    }
  );
});

it('retains fenced retries when signature storage fails without leaking its exception', async () => {
  const sample = fixture();
  sample.read.mockRejectedValue(new Error('synthetic-storage-body'));
  expect((await sample.run()).retryable).toBe(1);
  expect(sample.replay).not.toHaveBeenCalled();
  expect(sample.appRpc).not.toHaveBeenCalled();
  expect(JSON.stringify(sample.call.mock.calls)).not.toContain(
    'synthetic-storage-body'
  );
});

it('does not enable evidence routing when no prefunded callback is configured', () => {
  const sample = fixture();
  const result = createDurableReplayAdapters({
    store: { call: sample.call },
    app: {} as SupabaseClient,
    keyResolver: async () => key,
    leaseSeconds: 300,
  });
  expect(result.prefundedReplay).toBeUndefined();
  expect(sample.call).not.toHaveBeenCalled();
});
