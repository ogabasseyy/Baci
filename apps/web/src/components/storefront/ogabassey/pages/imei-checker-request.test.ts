import { beforeEach, describe, expect, it, vi } from 'vitest';
import { performImeiCheck, pollImeiCheck } from './imei-checker-request';

const validResult = { device: 'iPhone 15 Pro', imei: '490154203237518', modelNumber: '', status: 'Clean', icloud: 'Unknown', icloudLock: 'Unknown', simLock: 'Unknown', blacklistStatus: 'Unknown', carrier: 'Unknown', deviceImage: '', score: 50, deviceType: 'apple', verdict: 'Unknown', verdictType: 'caution' };

const mockFetchWithCsrf = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: mockFetchWithCsrf,
}));

describe('performImeiCheck', () => {
  beforeEach(() => {
    mockFetchWithCsrf.mockReset();
  });

  it('marks an insufficient-wallet response for the funding CTA', async () => {
    mockFetchWithCsrf.mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({
        balance: 200,
        code: 'WALLET_INSUFFICIENT',
        required: 1000,
        success: false,
      }),
    });

    const outcome = await performImeiCheck(
      '490154203237518',
      'full',
      1500,
      '00000000-0000-4000-8000-000000000000',
      'ogabassey'
    );

    expect(outcome).toMatchObject({
      error: expect.stringMatching(/insufficient wallet balance/i),
      keepRequestIdentity: false,
      needsWalletFunding: true,
      result: null,
    });
  });

  it('declares async capability and sends selected device context', async () => {
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        lookupId: '11111111-1111-4111-8111-111111111111',
        pollAfterMs: 2000,
        status: 'pending',
        success: true,
      }),
    });

    const outcome = await performImeiCheck(
      '490154203237518',
      'blacklist',
      700,
      '00000000-0000-4000-8000-000000000000',
      'ogabassey',
      'smartphone',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    );

    const init = mockFetchWithCsrf.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      clientCapabilities: ['imei-async-v1', 'imei-attempt-coordination-v1'],
      device: 'smartphone',
      merchantSlug: 'ogabassey',
      expectedUserId: '11111111-1111-4111-8111-111111111111',
      previousLookupId: '22222222-2222-4222-8222-222222222222',
    });
    expect(outcome).toMatchObject({
      error: null,
      keepRequestIdentity: true,
      pending: {
        lookupId: '11111111-1111-4111-8111-111111111111',
        pollAfterMs: 2000,
      },
      result: null,
    });
  });

  it('polls a pending lookup until a terminal result is returned', async () => {
    mockFetchWithCsrf
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({
          pollAfterMs: 5000,
          status: 'pending',
          success: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: validResult,
          status: 'complete',
          success: true,
        }),
      });

    await expect(pollImeiCheck('lookup-1', 'ogabassey')).resolves.toEqual({
      kind: 'pending',
      pollAfterMs: 5000,
    });
    await expect(
      pollImeiCheck('lookup-1', 'ogabassey')
    ).resolves.toMatchObject({
      kind: 'complete',
      result: { device: 'iPhone 15 Pro' },
    });
    expect(mockFetchWithCsrf).toHaveBeenNthCalledWith(
      1,
      '/api/storefront/imei-check/lookup-1?merchantSlug=ogabassey',
      { method: 'GET' }
    );
  });

  it('returns a successful result and clears the request identity', async () => {
    const result = validResult;
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: result,
        lookupId: '11111111-1111-4111-8111-111111111111',
        success: true,
      }),
    });

    await expect(
      performImeiCheck(
        '490154203237518',
        'full',
        1500,
        '00000000-0000-4000-8000-000000000000',
        'ogabassey'
      )
    ).resolves.toEqual({
      error: null,
      keepRequestIdentity: false,
      lookupId: '11111111-1111-4111-8111-111111111111',
      needsSignIn: false,
      needsWalletFunding: false,
      pending: null,
      result,
    });
  });

  it('preserves the request identity after a network failure', async () => {
    mockFetchWithCsrf.mockRejectedValue(new Error('offline'));

    await expect(
      performImeiCheck(
        '490154203237518',
        'full',
        1500,
        '00000000-0000-4000-8000-000000000000',
        'ogabassey'
      )
    ).resolves.toMatchObject({
      error: expect.stringMatching(/network error/i),
      keepRequestIdentity: true,
      lookupId: null,
      needsWalletFunding: false,
      result: null,
    });
  });
});

it('retains the key when a success response has no report', async () => {
  mockFetchWithCsrf.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });
  const outcome = await performImeiCheck('490154203237518', 'blacklist', 700, '11111111-1111-4111-8111-111111111111', 'ogabassey');
  expect(outcome.keepRequestIdentity).toBe(true);
  expect(outcome.result).toBeNull();
  expect(outcome.error).toBeTruthy();
});

it('retains the key when a success response contains a malformed report', async () => {
  mockFetchWithCsrf.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) });
  const outcome = await performImeiCheck('490154203237518', 'blacklist', 700, '11111111-1111-4111-8111-111111111111', 'ogabassey');
  expect(outcome.keepRequestIdentity).toBe(true);
  expect(outcome.result).toBeNull();
});
