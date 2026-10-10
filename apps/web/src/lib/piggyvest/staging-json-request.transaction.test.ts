import { describe, expect, it, vi } from 'vitest';
import { requestPiggyvestStagingJson } from './staging-json-request';

describe('transaction read transport boundary', () => {
  const configuration = {
    apiSecret: 'synthetic-secret',
    expectedBusinessId: 'synthetic-business',
  };
  it.each([
    '/api/v1/transaction/synthetic-transaction?wallet_id=synthetic-wallet',
    `/api/v1/transaction/${encodeURIComponent('opaque/東京')}?wallet_id=${encodeURIComponent('wallet #?')}`,
  ])('reads the exact wallet-filtered staging transaction once: %s', async (path) => {
    const fetchImplementation = vi.fn(async () =>
      Response.json({ status: true })
    );
    await expect(
      requestPiggyvestStagingJson({
        configuration,
        path,
        method: 'GET',
        fetchImplementation,
      })
    ).resolves.toEqual({ status: true });
    expect(fetchImplementation).toHaveBeenCalledExactlyOnceWith(
      `https://staging.piggyvest.business${path}`,
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
      })
    );
  });
  it.each([
    '/api/v1/transaction/txn',
    '/api/v1/transaction/txn?wallet_id=',
    '/api/v1/transaction/txn?wallet_id=wallet&wallet_id=other',
    '/api/v1/transaction/txn?wallet_id=wallet&business_id=other',
    '/api/v1/transaction/txn?wallet_id=wallet#fragment',
    '/api/v1/transaction/../txn?wallet_id=wallet',
    '/api/v1/transaction/%2E%2E?wallet_id=wallet',
    '/api/v1/transaction/%252e%252e?wallet_id=wallet',
    '/api/v1/transaction/txn?wallet_id=%0A',
    '/api/v1/transaction/txn?wallet_id=unencoded+space',
  ])('rejects missing scope or ambiguous encoding before HTTP: %s', async (path) => {
    const fetchImplementation = vi.fn();
    await expect(
      requestPiggyvestStagingJson({
        configuration,
        path,
        method: 'GET',
        fetchImplementation,
      })
    ).rejects.toThrow();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
  it('does not permit transaction mutations', async () => {
    const fetchImplementation = vi.fn();
    await expect(
      requestPiggyvestStagingJson({
        configuration,
        path: '/api/v1/transaction/txn?wallet_id=wallet',
        method: 'POST',
        body: '{}',
        fetchImplementation,
      })
    ).rejects.toThrow();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
