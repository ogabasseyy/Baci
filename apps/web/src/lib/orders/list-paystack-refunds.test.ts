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
function verifiedLister(fetcher: ReturnType<typeof vi.fn>) {
  fetcher.mockResolvedValueOnce(response({ id: 5, reference: 'capture-1' }));
  vi.stubGlobal('fetch', fetcher);
}
describe('listPaystackRefunds', () => {
  beforeEach(() => vi.stubEnv('PAYSTACK_SECRET_KEY', 'test-secret'));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it('resolves the transaction ID before listing refunds', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ id: 5, reference: 'capture-1' }))
      .mockResolvedValueOnce(response([refund]));
    vi.stubGlobal('fetch', fetcher);
    expect(await listPaystackRefunds('capture-1')).toEqual([
      { id: 1, amount: 100, currency: 'NGN', status: 'processed' },
    ]);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/transaction/verify/capture-1'),
      expect.anything()
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/refund?transaction=5&'),
      expect.anything()
    );
  });
  it('matches bare numeric and legacy string transaction identities', async () => {
    const fetcher = vi.fn();
    verifiedLister(fetcher);
    fetcher.mockResolvedValueOnce(
      response([
        { ...refund, id: 1, transaction: 5 },
        { ...refund, id: 2, transaction: 'capture-1' },
        { ...refund, id: 3, transaction: '5' },
      ])
    );
    expect(await listPaystackRefunds('capture-1')).toHaveLength(3);
    // Numeric identities compare against the resolved ID directly: no
    // per-row transaction lookups.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('reads another page after a full page', async () => {
    const fetcher = vi.fn();
    verifiedLister(fetcher);
    fetcher
      .mockResolvedValueOnce(
        response(
          Array.from({ length: 100 }, (_, i) => ({ ...refund, id: i + 1 }))
        )
      )
      .mockResolvedValueOnce(response([]));
    expect(await listPaystackRefunds('capture-1')).toHaveLength(100);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('blocks mismatched and malformed provider records', async () => {
    const fetcher = vi.fn();
    verifiedLister(fetcher);
    fetcher.mockResolvedValue(
      response([{ ...refund, transaction: { id: 9, reference: 'other' } }])
    );
    await expect(listPaystackRefunds('capture-1')).rejects.toThrow('mismatch');
  });
  it('rejects unverified refund transactions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ id: 'not-a-number' }))
    );
    await expect(listPaystackRefunds('capture-1')).rejects.toThrow(
      'Unverified refund transaction'
    );
  });
  it('preserves 64-bit transaction IDs as decimal text', async () => {
    const u64 = '18446744073709551615';
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ id: u64 }))
      .mockResolvedValueOnce(
        response([{ ...refund, transaction: { id: u64 } }])
      );
    vi.stubGlobal('fetch', fetcher);
    expect(await listPaystackRefunds('capture-1')).toHaveLength(1);
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`/refund?transaction=${u64}&`),
      expect.anything()
    );
  });
  it('reads oversized IDs off the wire text instead of the rounded parse', async () => {
    // 2^53+1 cannot survive JSON.parse; the wire text carries the
    // exact digits and the list filter must use them verbatim.
    const raw =
      '{"status":true,"data":{"id":9007199254740993,"reference":"capture-1"}}';
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => JSON.parse(raw),
        text: async () => raw,
      })
      .mockResolvedValueOnce(
        response([{ ...refund, transaction: { id: '9007199254740993' } }])
      );
    vi.stubGlobal('fetch', fetcher);
    expect(await listPaystackRefunds('capture-1')).toHaveLength(1);
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/refund?transaction=9007199254740993&'),
      expect.anything()
    );
  });
  it('matches a bare oversized transaction ID off the list wire text', async () => {
    // The same 2^53+1 corruption inside a list page: the nested
    // transaction quotes before parsing, so the row matches the
    // verified ID instead of quarantining for review.
    const big = '9007199254740993';
    const verifyRaw = `{"status":true,"data":{"id":${big},"reference":"capture-1"}}`;
    const listRaw = `{"status":true,"data":[{"id":1,"amount":100,"currency":"NGN","status":"processed","transaction":${big}}]}`;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => JSON.parse(verifyRaw),
        text: async () => verifyRaw,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => JSON.parse(listRaw),
        text: async () => listRaw,
      });
    vi.stubGlobal('fetch', fetcher);
    expect(await listPaystackRefunds('capture-1')).toHaveLength(1);
  });
  it('rejects a verify payload with a reordered data object', async () => {
    // The wire-ID anchor requires the ID as the data object's first
    // key; a nested ID in first position must fail closed rather
    // than resolve the wrong transaction.
    const raw =
      '{"status":true,"data":{"customer":{"id":9},"id":5,"reference":"capture-1"}}';
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
  it('rejects failed transport and missing configuration', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null, false)));
    await expect(listPaystackRefunds('capture-1')).rejects.toThrow('failed');
    vi.stubEnv('PAYSTACK_SECRET_KEY', '');
    await expect(listPaystackRefunds('capture-1')).rejects.toThrow(
      'unavailable'
    );
  });
  it('accepts punctuation references but rejects unsafe ones', async () => {
    const fetcher = vi.fn();
    verifiedLister(fetcher);
    fetcher.mockResolvedValueOnce(response([]));
    await expect(
      listPaystackRefunds('ref/with?special&chars#f')
    ).resolves.toEqual([]);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        '/transaction/verify/ref%2Fwith%3Fspecial%26chars%23f'
      ),
      expect.anything()
    );
    const rejected = vi.fn();
    vi.stubGlobal('fetch', rejected);
    for (const bad of ['', 'x'.repeat(101), 'bad\x01ref', 'bad\x7fref']) {
      await expect(listPaystackRefunds(bad)).rejects.toThrow(
        'Invalid payment reference'
      );
    }
    expect(rejected).not.toHaveBeenCalled();
  });
  it('caps provider calls to the remaining budget', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ id: 5, reference: 'capture-1' }))
      .mockResolvedValueOnce(response([refund]));
    vi.stubGlobal('fetch', fetcher);
    await listPaystackRefunds('capture-1', {
      deadlineMs: Date.now() + 5_000,
    });
    expect(timeout).toHaveBeenCalledWith(expect.any(Number));
    for (const call of timeout.mock.calls)
      expect(call[0] as number).toBeLessThanOrEqual(5_000);
    timeout.mockRestore();
  });
  it('recomputes the cap before every page', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async () => {
        now += 10_000;
        return response({ id: 5, reference: 'capture-1' });
      })
      .mockResolvedValueOnce(response([refund]));
    vi.stubGlobal('fetch', fetcher);
    await listPaystackRefunds('capture-1', { deadlineMs: 1_000_000 + 20_000 });
    // First request sees the full 20s (capped to the 15s transport
    // maximum); the second sees only the 10s left after the first.
    expect(timeout).toHaveBeenNthCalledWith(1, 15_000);
    expect(timeout).toHaveBeenNthCalledWith(2, 10_000);
    timeout.mockRestore();
    clock.mockRestore();
  });
});
