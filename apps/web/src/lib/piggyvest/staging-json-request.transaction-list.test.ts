import { describe, expect, it, vi } from 'vitest';
import { requestPiggyvestStagingJson } from './staging-json-request';

const path = '/api/v1/transaction?wallet_id=wallet&limit=20&collapse_batch=0';
const configuration = {
  apiSecret: 'synthetic-secret',
  expectedBusinessId: 'synthetic-business',
};
describe('transaction list transport boundary', () => {
  it('makes exactly one staging GET with an opaque cursor', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ status: true }));
    await requestPiggyvestStagingJson({
      configuration,
      path: `${path}&cursor=%252F+%2B%2F`,
      method: 'GET',
      fetchImplementation,
    });
    expect(fetchImplementation).toHaveBeenCalledExactlyOnceWith(
      `https://staging.piggyvest.business${path}&cursor=%252F+%2B%2F`,
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
      })
    );
  });
  it.each([
    { path, method: 'POST' as const },
    { path: '/api/v1/transaction', method: 'GET' as const },
    {
      path: '/api/v1/transaction?wallet_id=..&limit=20&collapse_batch=0',
      method: 'GET' as const,
    },
    { path: `${path}&collapse_batch=1`, method: 'GET' as const },
    { path: `${path}&wallet_id=other`, method: 'GET' as const },
    {
      path: '/api/v1/transactions?wallet_id=wallet&limit=20&collapse_batch=0',
      method: 'GET' as const,
    },
  ])('rejects expanded transport input before HTTP', async (input) => {
    const fetchImplementation = vi.fn<typeof fetch>();
    await expect(
      requestPiggyvestStagingJson({
        configuration,
        ...input,
        fetchImplementation,
      })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
