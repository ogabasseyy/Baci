import { createCipheriv, createHash, createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import type { PrefundedReceiptReplay } from './replay-prefunded';
import { createDurableReplayAdapters, type StoreRpc } from './replay-store';
import { adapters, event, key } from './replay-test-fixtures';
import { createReplayWorker, type ReplayAdapters } from './replay-worker';

function fixture(eventValue: unknown = event) {
  const raw = Buffer.from(`${JSON.stringify(eventValue, null, 2)}\n`);
  const digest = createHash('sha256').update(raw).digest('hex');
  const signature = createHmac('sha512', 'synthetic-provider-key')
    .update(raw)
    .digest('hex');
  const nonce = Buffer.alloc(12, 3);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`piggyvest-staging:staging-v1:${digest}`));
  const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
  const row = {
    receipt_id: 'receipt-001',
    payload_sha256: digest,
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    auth_tag: cipher.getAuthTag().toString('base64'),
    key_version: 'staging-v1',
    claim_token: 'claim-001',
    attempts: 1,
  };
  const calls: { fn: string; params: Record<string, unknown> }[] = [];
  const transition = vi.fn(async () => true);
  const store: StoreRpc = {
    async call<T>(fn: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ fn, params });
      if (fn === 'claim_piggyvest_staging_receipts') return [row] as T;
      return (await transition()) as T;
    },
  };
  const appRpc = vi.fn(async (fn: string) => ({
    data:
      fn === 'resolve_piggyvest_staging_goal_mapping'
        ? [
            {
              customer_id: 'customer-001',
              merchant_id: 'merchant-001',
              provider_customer_id: event.customer_id,
              provider_wallet_id: event.pvb_wallet,
            },
          ]
        : 'recognized',
    error: null,
  }));
  const resolveEnrollment = vi.fn<PrefundedReceiptReplay['resolveEnrollment']>(
    async () => 'enrolled'
  );
  const readOriginalSignature = vi.fn<
    NonNullable<PrefundedReceiptReplay['readOriginalSignature']>
  >(async () => ({
    receiptId: row.receipt_id,
    payloadSha256: digest,
    signature,
  }));
  const replay = vi.fn<PrefundedReceiptReplay['replay']>(async () => ({
    outcome: 'processed',
    projection: 'applied',
  }));
  const callbacks = { resolveEnrollment, readOriginalSignature, replay };
  const financial = vi.fn(async () => 'duplicate' as const);
  const run = (
    prefundedReplay: PrefundedReceiptReplay | undefined = callbacks
  ) =>
    createReplayWorker(
      createDurableReplayAdapters({
        prefundedReplay,
        dispatchFinancial: financial,
        store,
        app: { rpc: appRpc } as unknown as SupabaseClient,
        keyResolver: async () => key,
        leaseSeconds: 300,
      }),
      { environment: 'staging', batchSize: 1, keyResolver: async () => key }
    ).run();
  return {
    raw,
    digest,
    signature,
    row,
    calls,
    transition,
    appRpc,
    callbacks,
    financial,
    run,
  };
}

it('uses exact decrypted bytes and the original bound signature before legacy mapping, then resolves by claim token', async () => {
  const sample = fixture();
  sample.callbacks.resolveEnrollment.mockImplementation(
    async ({ rawPayload }) => {
      rawPayload.fill(0);
      return 'enrolled';
    }
  );
  expect((await sample.run()).processed).toBe(1);
  const input = sample.callbacks.replay.mock.calls[0][0];
  expect(Buffer.from(input.rawPayload)).toEqual(sample.raw);
  expect(Buffer.from(input.rawPayload)).not.toEqual(
    Buffer.from(JSON.stringify(event))
  );
  expect(input.signature).toBe(sample.signature);
  expect(sample.callbacks.readOriginalSignature).toHaveBeenCalledWith({
    receiptId: 'receipt-001',
    payloadSha256: sample.digest,
    claimToken: 'claim-001',
  });
  expect(sample.appRpc).not.toHaveBeenCalled();
  expect(sample.calls.at(-1)).toEqual({
    fn: 'resolve_piggyvest_staging_receipt',
    params: {
      p_receipt_id: 'receipt-001',
      p_claim_token: 'claim-001',
      p_status: 'processed',
      p_last_error: null,
    },
  });
});

it.each([
  'absent-reader',
  'missing-receipt',
])('retries an enrolled receipt with %s instead of manufacturing a signature or crediting', async (missing) => {
  const sample = fixture();
  sample.callbacks.readOriginalSignature.mockResolvedValue(null);
  const callbacks =
    missing === 'absent-reader'
      ? {
          resolveEnrollment: sample.callbacks.resolveEnrollment,
          replay: sample.callbacks.replay,
        }
      : sample.callbacks;
  expect(await sample.run(callbacks)).toMatchObject({
    processed: 0,
    retryable: 1,
    quarantined: 0,
  });
  expect(sample.callbacks.replay).not.toHaveBeenCalled();
  expect(sample.appRpc).not.toHaveBeenCalled();
  expect(sample.calls.at(-1)).toMatchObject({
    fn: 'resolve_piggyvest_staging_receipt',
    params: {
      p_claim_token: 'claim-001',
      p_status: 'quarantined',
      p_last_error: 'worker retryable',
    },
  });
});

it.each([
  'deferred',
  'unknown',
  null,
])('never treats unresolved enrollment %s as legacy', async (enrollment) => {
  const sample = fixture();
  sample.callbacks.resolveEnrollment.mockResolvedValue(enrollment);
  expect((await sample.run()).retryable).toBe(1);
  expect(sample.callbacks.replay).not.toHaveBeenCalled();
  expect(sample.appRpc).not.toHaveBeenCalled();
});

it('preserves the existing inflow RPC only after explicit trusted legacy enrollment', async () => {
  const sample = fixture();
  sample.callbacks.resolveEnrollment.mockResolvedValue('legacy');
  expect((await sample.run()).processed).toBe(1);
  expect(sample.callbacks.readOriginalSignature).not.toHaveBeenCalled();
  expect(sample.callbacks.replay).not.toHaveBeenCalled();
  expect(sample.appRpc).toHaveBeenCalledWith(
    'recognize_piggyvest_staging_inflow',
    expect.objectContaining({
      p_event_id: event.eventId,
      p_wallet_id: event.pvb_wallet,
      p_session_id: null,
    })
  );
});

it.each([
  'receipt',
  'digest',
  'malformed',
])('refuses %s signature provenance before provider replay', async (mismatch) => {
  const sample = fixture();
  sample.callbacks.readOriginalSignature.mockResolvedValue({
    receiptId: mismatch === 'receipt' ? 'another-receipt' : 'receipt-001',
    payloadSha256: mismatch === 'digest' ? '0'.repeat(64) : sample.digest,
    signature: mismatch === 'malformed' ? 'not-a-signature' : sample.signature,
  });
  expect((await sample.run()).retryable).toBe(1);
  expect(sample.callbacks.replay).not.toHaveBeenCalled();
  expect(sample.appRpc).not.toHaveBeenCalled();
});

it.each([
  { outcome: 'retry', stage: 'evidence' },
  { outcome: 'retry', stage: 'projection' },
  { outcome: 'processed', projection: 'not_applicable' },
  { outcome: 'processed' },
])('retains a reclaimable receipt for an uncredited bank outcome %j', async (outcome) => {
  const sample = fixture();
  sample.callbacks.replay.mockResolvedValue(outcome);
  expect(await sample.run()).toMatchObject({ processed: 0, retryable: 1 });
  expect(sample.appRpc).not.toHaveBeenCalled();
});

it.each([
  { outcome: 'reconciliation_required', reason: 'conflict' },
  { outcome: 'rejected', reason: 'poison' },
])('uses fenced quarantine after $outcome without unverified fallback', async ({
  outcome,
  reason,
}) => {
  const sample = fixture();
  sample.callbacks.replay.mockResolvedValue({ outcome });
  expect(await sample.run()).toMatchObject({ processed: 0, quarantined: 1 });
  expect(sample.calls.at(-1)).toMatchObject({
    fn: 'quarantine_piggyvest_staging_receipt',
    params: {
      p_receipt_id: 'receipt-001',
      p_claim_token: 'claim-001',
      p_event_id: event.eventId,
      p_reason: reason,
      p_detail: null,
    },
  });
  expect(sample.appRpc).not.toHaveBeenCalled();
});

it.each([
  'resolveEnrollment',
  'readOriginalSignature',
  'replay',
] as const)('keeps %s storage failures retryable with sanitized receipt diagnostics', async (method) => {
  const sample = fixture();
  sample.callbacks[method].mockRejectedValue(
    new Error('synthetic-sensitive-body')
  );
  expect((await sample.run()).retryable).toBe(1);
  expect(JSON.stringify(sample.calls)).not.toContain(
    'synthetic-sensitive-body'
  );
  expect(sample.appRpc).not.toHaveBeenCalled();
});

it.each([
  'processed',
  'reconciliation_required',
] as const)('counts a failed $outcome lease CAS as a resolution failure', async (outcome) => {
  const sample = fixture();
  sample.callbacks.replay.mockResolvedValue(
    outcome === 'processed' ? { outcome, projection: 'duplicate' } : { outcome }
  );
  sample.transition.mockResolvedValue(false);
  expect(await sample.run()).toMatchObject({
    processed: 0,
    quarantined: 0,
    retryable: 0,
    resolutionFailures: 1,
  });
  expect(sample.appRpc).not.toHaveBeenCalled();
});

it('does not let prefunded evidence bypass authenticated decryption', async () => {
  const sample = fixture();
  sample.row.auth_tag = Buffer.alloc(16, 0).toString('base64');
  expect((await sample.run()).quarantined).toBe(1);
  expect(sample.callbacks.resolveEnrollment).not.toHaveBeenCalled();
  expect(sample.callbacks.replay).not.toHaveBeenCalled();
});

it('acknowledges stored enrolled wallet-transfer evidence without another financial or bank write', async () => {
  const sample = fixture({
    eventId: 'outflow',
    eventType: 'wallet-transfer.outflow.success',
    eventCategory: 'wallet-transfer',
    customer_id: 'source-customer',
    pvb_wallet: 'treasury',
    pvb_reference: 'transfer',
    eventData: { reference: 'transfer' },
  });
  sample.callbacks.replay.mockResolvedValue({
    outcome: 'processed',
    projection: 'not_applicable',
  });
  expect((await sample.run()).processed).toBe(1);
  expect(
    Buffer.from(sample.callbacks.replay.mock.calls[0][0].rawPayload)
  ).toEqual(sample.raw);
  expect(sample.financial).not.toHaveBeenCalled();
  expect(sample.appRpc).not.toHaveBeenCalled();
});

it('keeps other financial event routing outside the optional bank/card evidence callback', async () => {
  const sample = fixture({
    eventId: 'outflow-bank',
    eventType: 'bank-transfer.outflow.success',
    eventCategory: 'outflow',
    customer_id: 'source-customer',
    eventData: { reference: 'transfer' },
  });
  expect((await sample.run()).processed).toBe(1);
  expect(sample.callbacks.resolveEnrollment).not.toHaveBeenCalled();
  expect(sample.financial).toHaveBeenCalledOnce();
  expect(sample.appRpc).not.toHaveBeenCalled();
});

it('does not mistake a null legacy dispatch outcome for the prefunded fallthrough sentinel', async () => {
  const legacy = adapters({
    dispatch: vi.fn(async () => null) as unknown as ReplayAdapters['dispatch'],
  });
  expect(
    await createReplayWorker(legacy, {
      environment: 'staging',
      batchSize: 1,
      keyResolver: async () => key,
    }).run()
  ).toMatchObject({ processed: 0, retryable: 1 });
  expect(legacy.resolve).toHaveBeenCalledWith(
    expect.objectContaining({
      status: 'retryable',
      reason: 'invalid-dispatch-outcome',
    })
  );
});
