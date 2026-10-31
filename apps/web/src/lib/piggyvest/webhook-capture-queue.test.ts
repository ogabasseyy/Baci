import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import { createCaptureQueue } from './webhook-capture-queue';

const claimRow = {
  capture_id: '4204dc18-efb3-44d0-b9a2-1362448d4f21',
  claim_token: '6b9d2f4a-3c1e-4a5b-9d8f-2e4b6a8c0d12',
  raw_hex: '7b7d',
  signature: 'ab'.repeat(64),
  key_version: 'k-0123456789abcdef',
  key_families: ['legacy'],
  attempts: 1,
  event_type: null,
  provider_transaction_id: null,
};

function clientWith(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => result);
  return {
    client: { rpc } as unknown as PiggyvestIntakeServiceClient,
    rpc,
  };
}

describe('createCaptureQueue', () => {
  it('claims due rows with a lease and a grace period for inline processing', async () => {
    const { client, rpc } = clientWith({ data: [claimRow], error: null });

    await expect(createCaptureQueue(client).claim(10)).resolves.toEqual([
      claimRow,
    ]);
    expect(rpc).toHaveBeenCalledWith('claim_piggyvest_webhook_captures', {
      p_limit: 10,
      p_lease_seconds: 300,
      p_min_age_seconds: 120,
    });
  });

  it('refuses to act on malformed claim rows', async () => {
    const { client } = clientWith({
      data: [{ ...claimRow, raw_hex: 'not hex' }],
      error: null,
    });
    await expect(createCaptureQueue(client).claim(10)).rejects.toThrow(
      'PiggyVest capture claim failed'
    );
  });

  it('surfaces a storage error without database detail', async () => {
    const { client } = clientWith({
      data: null,
      error: { message: 'relation public.piggyvest_webhook_captures missing' },
    });
    const failure = createCaptureQueue(client).claim(10);
    await expect(failure).rejects.toThrow('PiggyVest capture claim failed');
    await expect(failure).rejects.not.toThrow(/relation/);
  });

  it('resolves a claimed row fenced by its claim token', async () => {
    const { client, rpc } = clientWith({ data: true, error: null });

    await expect(
      createCaptureQueue(client).resolve(
        claimRow.capture_id,
        claimRow.claim_token,
        'needs_review',
        'REPLAY_SIGNATURE_UNVERIFIABLE'
      )
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('resolve_piggyvest_webhook_capture', {
      p_id: claimRow.capture_id,
      p_claim_token: claimRow.claim_token,
      p_state: 'needs_review',
      p_error: 'REPLAY_SIGNATURE_UNVERIFIABLE',
    });
  });

  it('defers a configuration-blocked row through the same fenced resolve call', async () => {
    const { client, rpc } = clientWith({ data: true, error: null });

    await expect(
      createCaptureQueue(client).resolve(
        claimRow.capture_id,
        claimRow.claim_token,
        'deferred',
        'KEYS_UNCONFIGURED'
      )
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('resolve_piggyvest_webhook_capture', {
      p_id: claimRow.capture_id,
      p_claim_token: claimRow.claim_token,
      p_state: 'deferred',
      p_error: 'KEYS_UNCONFIGURED',
    });
  });

  it('reports a lost lease as false instead of throwing', async () => {
    const { client } = clientWith({ data: false, error: null });
    await expect(
      createCaptureQueue(client).resolve(
        claimRow.capture_id,
        claimRow.claim_token,
        'processed',
        null
      )
    ).resolves.toBe(false);
  });
});
