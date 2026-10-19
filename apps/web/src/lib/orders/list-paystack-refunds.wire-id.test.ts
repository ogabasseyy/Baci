import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { listPaystackRefunds } from './list-paystack-refunds';

const refund = {
  id: 1,
  amount: 100,
  currency: 'NGN',
  status: 'processed',
  transaction: { id: 5, reference: 'capture-1' },
};
function response(data: unknown, ok = true) {
  return {
    ok,
    json: async () => ({ status: true, data }),
    text: async () => JSON.stringify({ status: true, data }),
  } as unknown as Response;
}

describe('listPaystackRefunds wire data.id', () => {
  beforeEach(() => vi.stubEnv('PAYSTACK_SECRET_KEY', 'test-secret'));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it('reads data.id regardless of member order or nested decoy ids', async () => {
    // Member order is not contractual: new or expanded fields may
    // precede the id, and nested objects carry their own ids. Only
    // the top-level data.id — exact digits past 2^53 — may win.
    const big = '9007199254740993';
    const raw =
      `{"status":true,"message":"ok","data":{"domain":"test",` +
      `"authorization":{"id":7,"channel":"card"},"customer":{"id":9},` +
      `"id":${big},"reference":"capture-1"}}`;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => JSON.parse(raw),
        text: async () => raw,
      })
      .mockResolvedValueOnce(
        response([{ ...refund, transaction: { id: big } }])
      );
    vi.stubGlobal('fetch', fetcher);
    expect(await listPaystackRefunds('capture-1')).toHaveLength(1);
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`/refund?transaction=${big}&`),
      expect.anything()
    );
  });
  it('fails closed when only nested ids exist', async () => {
    const raw =
      '{"status":true,"data":{"authorization":{"id":7},"reference":"capture-1"}}';
    const fetcher = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => JSON.parse(raw),
      text: async () => raw,
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(listPaystackRefunds('capture-1')).rejects.toThrow(
      'Unverified refund transaction'
    );
  });
});
