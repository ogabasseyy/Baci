import { jest } from '@jest/globals';
import type { FetchImplementation } from '@/types/fetch';
import { submitImeiCheck } from './submit-imei-check';

describe('submitImeiCheck', () => {
  it('sends async capability and selected device context', async () => {
    const fetchImpl = jest.fn<FetchImplementation>().mockResolvedValue({
      json: () => Promise.resolve({ success: true }),
      ok: true,
      status: 200,
    } as Response);

    await submitImeiCheck({
      accessToken: 'token',
      apiBaseUrl: 'https://shop.example.com',
      device: 'smartphone',
      fetchImpl,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      identifier: '490154203237518',
      signal: new AbortController().signal,
      tier: 'blacklist',
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      clientCapabilities: ['imei-async-v1'],
      device: 'smartphone',
      imei: '490154203237518',
      tier: 'blacklist',
    });
  });
});
