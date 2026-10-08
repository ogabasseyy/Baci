import { describe, expect, it, vi } from 'vitest';
import { requestPiggyvestStagingJson } from './staging-json-request';

describe('accrued interest transport boundary', () => {
  const prefix = '/api/v1/wallet/interests/accrued/synthetic-wallet';
  const configuration = {
    apiSecret: 'synthetic-secret',
    expectedBusinessId: 'synthetic-business',
  };
  it('never permits POST or traversal on the interest endpoint', async () => {
    const fetchImplementation = vi.fn();
    for (const input of [
      { path: prefix, method: 'POST' as const },
      {
        path: '/api/v1/wallet/interests/accrued/%2E%2E',
        method: 'GET' as const,
      },
      { path: `${prefix}?cursor=${'x'.repeat(513)}`, method: 'GET' as const },
    ]) {
      await expect(
        requestPiggyvestStagingJson({
          configuration,
          ...input,
          fetchImplementation,
        })
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
  it.each([
    '',
    '?limit=31&interest_type=original',
    '?cursor=%252F',
    '?start_date=2026-09-01&end_date=2026-09-30&limit=100&cursor=opaque%2Fcursor&interest_type=differential',
  ])('reads one bounded page using GET: %s', async (query) => {
    const fetchImplementation = vi.fn(async () =>
      Response.json({ status: true })
    );
    await expect(
      requestPiggyvestStagingJson({
        configuration,
        path: `${prefix}${query}`,
        method: 'GET',
        fetchImplementation,
      })
    ).resolves.toEqual({ status: true });
    expect(fetchImplementation).toHaveBeenCalledExactlyOnceWith(
      `https://staging.piggyvest.business${prefix}${query}`,
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
      })
    );
  });
  it.each([
    '?limit=101',
    '?limit=0',
    '?limit=01',
    '?limit=1.5',
    '?limit=1&limit=2',
    '?wallet_id=other',
    '?interest_type=paid',
    '?cursor=',
    '?cursor=%0A',
    '?cursor=x#fragment',
    '?start_date=2026-02-30',
    '?start_date=2026-10-01&end_date=2026-09-01',
    '?unknown=x',
    '?',
  ])('rejects ambiguous or unsupported queries before HTTP: %s', async (query) => {
    const fetchImplementation = vi.fn();
    await expect(
      requestPiggyvestStagingJson({
        configuration,
        path: `${prefix}${query}`,
        method: 'GET',
        fetchImplementation,
      })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
