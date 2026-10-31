import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deterministicTestUuid } from '@/lib/piggyvest/deterministic-test-data.test-support';
import {
  CAPTURE_ID,
  capturedReceipt,
  createCaptureRpc,
  createFakeCaptureStore,
  withCaptureRpc,
} from './route.capture-test-support';

function command(body: string, overrides: Record<string, unknown> = {}) {
  return {
    rawHex: Buffer.from(body).toString('hex'),
    bodyDigest: createHash('sha256').update(body).digest('hex'),
    signature: 'ab'.repeat(64),
    eventId: 'evt-1',
    eventType: 'x',
    headers: {},
    keyVersion: 'k-1',
    keyFamilies: ['legacy'],
    keyStatus: 'current',
    ...overrides,
  };
}

describe('capture receipt helpers', () => {
  it('builds a captured pending receipt that tests can override', () => {
    expect(capturedReceipt()).toEqual({
      data: { outcome: 'captured', id: CAPTURE_ID, processingState: 'pending' },
      error: null,
    });
    expect(capturedReceipt({ outcome: 'duplicate' }).data).toMatchObject({
      outcome: 'duplicate',
    });
  });

  it('routes rpc names: capture is configurable, everything else succeeds', async () => {
    const rpc = createCaptureRpc(async () => ({
      data: null,
      error: { message: 'down' },
    }));
    await expect(rpc('capture_piggyvest_webhook_delivery')).resolves.toEqual({
      data: null,
      error: { message: 'down' },
    });
    await expect(rpc('resolve_piggyvest_webhook_capture')).resolves.toEqual({
      data: true,
      error: null,
    });
  });

  it('adds rpc to an existing mock client without replacing its members', () => {
    const from = () => 'table';
    const wrapped = withCaptureRpc({ from });
    expect(wrapped.from).toBe(from);
    expect(typeof wrapped.rpc).toBe('function');
    expect(typeof withCaptureRpc(undefined).rpc).toBe('function');
  });
});

describe('createFakeCaptureStore', () => {
  it('captures once and reports an identical redelivery as a duplicate', () => {
    const store = createFakeCaptureStore();
    expect(store.capture(command('{}')).data).toMatchObject({
      outcome: 'captured',
    });
    expect(store.capture(command('{}')).data).toMatchObject({
      outcome: 'duplicate',
    });
    expect(store.rows).toHaveLength(1);
  });

  it('keeps a same-event, different-body delivery as separate evidence', () => {
    const store = createFakeCaptureStore();
    store.capture(command('{}'));
    store.capture(command('{ }'));
    expect(store.rows).toHaveLength(2);
  });

  it('keys events without an id by their digest', () => {
    const store = createFakeCaptureStore();
    store.capture(command('<<x>>', { eventId: null }));
    expect(store.rows[0]?.eventKey).toBe(
      `raw:${createHash('sha256').update('<<x>>').digest('hex')}`
    );
  });

  it('rejects a command whose digest does not match its bytes, storing nothing', () => {
    const store = createFakeCaptureStore();
    const result = store.capture(command('{}', { bodyDigest: '0'.repeat(64) }));
    expect(result.error).toBeTruthy();
    expect(store.rows).toEqual([]);
  });

  it('simulates an outage and records inline completions', async () => {
    const store = createFakeCaptureStore();
    const client = store.client();
    store.failCapture = true;
    const failed = await client.rpc('capture_piggyvest_webhook_delivery', {
      p_command: command('{}'),
    });
    expect(failed.error).toBeTruthy();
    expect(store.rows).toEqual([]);

    store.failCapture = false;
    await client.rpc('capture_piggyvest_webhook_delivery', {
      p_command: command('{}'),
    });
    await client.rpc('resolve_piggyvest_webhook_capture', {
      p_id: store.rows[0]?.id,
      p_claim_token: null,
      p_state: 'processed',
      p_error: null,
    });
    expect(store.rows[0]?.processingState).toBe('processed');
    expect(store.resolveCalls).toHaveLength(1);
    expect(() => client.from()).toThrow('mocked out');
  });

  it('treats the matched signing families as part of the capture identity', () => {
    const store = createFakeCaptureStore();
    const wrong = store.capture(command('{}', { keyFamilies: ['interest'] }));
    const right = store.capture(command('{}', { keyFamilies: ['bank'] }));
    expect(wrong.data).toMatchObject({ outcome: 'captured' });
    expect(right.data).toMatchObject({ outcome: 'captured' });
    expect(store.rows.map((row) => row.signingFamilies)).toEqual([
      'interest',
      'bank',
    ]);

    // Same family again, even listed in another order, is a duplicate.
    const shared = store.capture(
      command('{}', { keyFamilies: ['legacy', 'bank'] })
    );
    const reordered = store.capture(
      command('{}', { keyFamilies: ['bank', 'legacy'] })
    );
    expect(shared.data).toMatchObject({ outcome: 'captured' });
    expect(reordered.data).toMatchObject({ outcome: 'duplicate' });
    expect(store.rows).toHaveLength(3);
  });

  it('claims pending rows once, fenced by a lease token', () => {
    const store = createFakeCaptureStore();
    store.capture(command('{}'));

    const [claimed, ...rest] = store.claim(10);
    expect(rest).toEqual([]);
    expect(claimed).toMatchObject({
      raw_hex: Buffer.from('{}').toString('hex'),
      attempts: 1,
    });
    expect(store.claim(10)).toEqual([]);

    const row = store.rows[0];
    // An inline (no token) completion cannot touch a claimed row.
    expect(
      store.resolve({
        p_id: row?.id,
        p_claim_token: null,
        p_state: 'processed',
      })
    ).toBe(false);
    expect(
      store.resolve({
        p_id: row?.id,
        p_claim_token: deterministicTestUuid('wrong-claim-token'),
        p_state: 'processed',
      })
    ).toBe(false);
    expect(
      store.resolve({
        p_id: row?.id,
        p_claim_token: claimed?.claim_token,
        p_state: 'needs_review',
      })
    ).toBe(true);
    expect(row?.processingState).toBe('needs_review');
  });
});
