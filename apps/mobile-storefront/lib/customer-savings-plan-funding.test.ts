import { describe, expect, it } from '@jest/globals';
import { mockFetchWithTimeout } from '@/lib/wallet-top-up.test-utils';

const { fetchExistingSavingsPlanFunding, fetchSavingsPlanFunding } =
  require('@/lib/customer-savings') as typeof import('@/lib/customer-savings');

function okJson(json: Record<string, unknown>) {
  mockFetchWithTimeout.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => json,
  });
}

describe('fetchSavingsPlanFunding', () => {
  it('gets a mapped plan account without sending a BVN or provisioning body', async () => {
    okJson({ status: 'pending', code: 'MAPPING_PENDING' });

    await expect(
      fetchExistingSavingsPlanFunding({
        goalId: 'goal-1',
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
      })
    ).resolves.toEqual({ status: 'pending', code: 'MAPPING_PENDING' });

    const [url, init] = mockFetchWithTimeout.mock.calls[0];
    expect(String(url)).toContain('/api/storefront/customer/savings/funding');
    expect(String(url)).toContain('goalId=goal-1');
    expect(String(url)).toContain('merchantId=merchant-1');
    expect(init).toMatchObject({ method: 'GET' });
    expect((init as { body?: string }).body).toBeUndefined();
  });

  it('posts the BVN and goal to the funding endpoint with merchant query', async () => {
    okJson({
      status: 'ready',
      accounts: [
        {
          accountNumber: '0001234567',
          accountName: 'Synthetic account',
          bankName: 'Synthetic bank',
        },
      ],
    });

    await expect(
      fetchSavingsPlanFunding({
        bvn: '00000000000',
        goalId: 'goal-1',
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
      })
    ).resolves.toEqual({
      status: 'ready',
      accounts: [
        {
          accountNumber: '0001234567',
          accountName: 'Synthetic account',
          bankName: 'Synthetic bank',
        },
      ],
    });

    const [url, init] = mockFetchWithTimeout.mock.calls[0];
    expect(String(url)).toContain('/api/storefront/customer/savings/funding');
    expect(String(url)).toContain('merchantId=merchant-1');
    expect(init).toMatchObject({ method: 'POST' });
    const body = JSON.parse(String((init as { body: string }).body));
    expect(body).toEqual({ bvn: '00000000000', goalId: 'goal-1' });
  });

  it('provisions through legacy funding when primary reports unconfigured', async () => {
    mockFetchWithTimeout
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ token: 'csrf-token' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({
          error: 'Savings wallet setup is unavailable.',
          code: 'SAVINGS_NOT_READY',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          status: 'ready',
          accounts: [
            {
              accountNumber: '0001234567',
              accountName: 'Synthetic account',
              bankName: 'Synthetic bank',
            },
          ],
        }),
      });

    await expect(
      fetchSavingsPlanFunding({
        bvn: '00000000000',
        goalId: '22222222-2222-4222-8222-222222222222',
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        merchantSlug: 'ogabassey',
      })
    ).resolves.toMatchObject({ status: 'ready' });

    const urls = mockFetchWithTimeout.mock.calls
      .map(([url]) => String(url))
      .filter((url) => !url.includes('/api/csrf'));
    expect(urls[0]).toContain(
      '/api/storefront/customer/savings/primary-provisioning'
    );
    expect(urls[1]).toContain('/api/storefront/customer/savings/funding');
  });

  it('includes the interest opt-in only when requested', async () => {
    okJson({ status: 'pending', code: 'PROVISIONING_IN_PROGRESS' });

    await fetchSavingsPlanFunding({
      bvn: '00000000000',
      goalId: 'goal-1',
      enableInterestAccrual: true,
    });

    const [, init] = mockFetchWithTimeout.mock.calls[0];
    expect(JSON.parse(String((init as { body: string }).body))).toEqual({
      bvn: '00000000000',
      goalId: 'goal-1',
      enableInterestAccrual: true,
    });
  });

  it('surfaces pending provisioning without accounts', async () => {
    okJson({ status: 'pending', code: 'PROVISIONING_IN_PROGRESS' });

    await expect(
      fetchSavingsPlanFunding({ bvn: '00000000000', goalId: 'goal-1' })
    ).resolves.toEqual({
      status: 'pending',
      code: 'PROVISIONING_IN_PROGRESS',
    });
  });

  it('rejects provider metadata leaking through the response', async () => {
    okJson({
      status: true,
      data: [{ account_number: '0001234567' }],
    });

    await expect(
      fetchSavingsPlanFunding({ bvn: '00000000000', goalId: 'goal-1' })
    ).rejects.toThrow();
  });
});
