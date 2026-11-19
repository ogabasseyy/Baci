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

describe('bugfix: a transient poll failure retired a paid lookup and its key', () => {
  const answer = (status: number, body: Record<string, unknown>) =>
    jest.fn<FetchImplementation>().mockResolvedValue({
      json: () => Promise.resolve(body),
      ok: status < 400,
      status,
    } as Response);
  const poll = (fetchImpl: FetchImplementation) =>
    pollImeiLookup({
      accessToken: 'token',
      apiBaseUrl: 'https://shop.example.com',
      fetchImpl,
      lookupId: '11111111-1111-4111-8111-111111111111',
    });

  it.each([
    [500, 'LOOKUP_READ_FAILED'],
    [503, 'IMEI_ACCESS_UNAVAILABLE'],
    [401, 'AUTH_REQUIRED'],
    [429, 'RATE_LIMITED'],
  ])('keeps polling an unsettled lookup after a %i %s', async (status, code) => {
    await expect(
      poll(
        answer(status, {
          success: false,
          status: 'error',
          code,
          error: 'Temporary',
        })
      )
    ).resolves.toEqual({ kind: 'retry', pollAfterMs: 10_000 });
  });

  it('still settles a lookup the server finished with an error status', async () => {
    await expect(
      poll(
        answer(502, {
          success: false,
          status: 'error',
          error: 'Provider failed',
          lookupId: '11111111-1111-4111-8111-111111111111',
        })
      )
    ).resolves.toEqual({ kind: 'error', error: 'Provider failed' });
  });

  it('still ends a lookup the server no longer has', async () => {
    await expect(
      poll(
        answer(404, {
          success: false,
          status: 'error',
          code: 'LOOKUP_NOT_FOUND',
          error: 'Lookup not found',
        })
      )
    ).resolves.toEqual({ kind: 'error', error: 'Lookup not found' });
  });
});
