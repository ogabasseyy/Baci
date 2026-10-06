import { afterEach, describe, expect, it, vi } from 'vitest';
import { retrievePiggyvestStagingWallet } from './read-only-client';

const configuration = {
  apiSecret: 'synthetic-secret',
  expectedBusinessId: 'synthetic-business',
  timeoutMs: 20,
};

afterEach(() => vi.useRealTimers());

describe('wallet transport regressions', () => {
  it('settles at the deadline when injected fetch ignores abort', async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn(() => new Promise<Response>(() => {}));
    let result: unknown;
    void retrievePiggyvestStagingWallet({
      configuration,
      walletId: 'synthetic-wallet',
      fetchImplementation,
    }).catch((error: unknown) => {
      result = error;
    });

    await vi.advanceTimersByTimeAsync(20);

    expect(result).toMatchObject({
      name: 'PiggyvestStagingWalletRetrievalError',
      code: 'TIMEOUT',
    });
  });

  it('rejects invalid UTF8 rather than accepting replacement characters', async () => {
    const prefix = new TextEncoder().encode(
      '{"status":true,"data":{"id":"synthetic-wallet","business_id":"synthetic-business","currency":"NGN","balance":0,"status":"'
    );
    const bytes = new Uint8Array([...prefix, 0xff, 34, 125, 125]);

    await expect(
      retrievePiggyvestStagingWallet({
        configuration,
        walletId: 'synthetic-wallet',
        fetchImplementation: vi.fn(async () => new Response(bytes)),
      })
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
