import { jest } from '@jest/globals';
import type { FetchImplementation } from '@/types/fetch';
import { pollImeiLookup } from './imei-poll-client';

describe('pollImeiLookup', () => {
  it('returns a typed pending response', async () => {
    const fetchImpl = jest.fn<FetchImplementation>().mockResolvedValue({
      json: () =>
        Promise.resolve({
          lookupId: '11111111-1111-4111-8111-111111111111',
          pollAfterMs: 5000,
          status: 'pending',
          success: true,
        }),
      ok: true,
      status: 202,
    } as Response);

    await expect(
      pollImeiLookup({
        accessToken: 'token',
        apiBaseUrl: 'https://shop.example.com',
        fetchImpl,
        lookupId: '11111111-1111-4111-8111-111111111111',
      })
    ).resolves.toEqual({ kind: 'pending', pollAfterMs: 5000 });
  });

  it('returns a validated terminal result', async () => {
    const fetchImpl = jest.fn<FetchImplementation>().mockResolvedValue({
      json: () =>
        Promise.resolve({
          data: {
            blacklistStatus: 'Clean',
            carrier: 'Unlocked',
            device: 'iPhone',
            deviceImage: '',
            deviceType: 'apple',
            icloud: 'Off',
            icloudLock: 'Off',
            imei: '490154203237518',
            modelNumber: 'A1',
            score: 98,
            simLock: 'Unlocked',
            status: 'Clean',
            verdict: 'Safe',
            verdictType: 'safe',
          },
          status: 'complete',
          success: true,
        }),
      ok: true,
      status: 200,
    } as Response);

    await expect(
      pollImeiLookup({
        apiBaseUrl: 'https://shop.example.com',
        fetchImpl,
        lookupId: '11111111-1111-4111-8111-111111111111',
      })
    ).resolves.toMatchObject({
      kind: 'complete',
      result: { device: 'iPhone' },
    });
  });
});
