import { jest } from '@jest/globals';
import type { FetchImplementation } from '@/types/fetch';
import { createImeiRemediationClient } from './imei-remediation-client';

describe('createImeiRemediationClient', () => {
  it('requests server-approved eligibility with storefront bearer auth', async () => {
    const fetchImpl = jest.fn<FetchImplementation>().mockResolvedValue({
      json: () =>
        Promise.resolve({
          assessmentId: '22222222-2222-4222-8222-222222222222',
          offers: [
            {
              carrier: 'AT&T',
              id: '33333333-3333-4333-8333-333333333333',
              name: 'AT&T Clean Unlock',
              priceNgn: 100000,
              priceUsdt: 65,
              refundPolicy: 'refundable',
              successRate: 82,
              turnaround: '1-7 Days',
            },
          ],
          status: 'eligible',
          success: true,
          usdtEnabled: true,
        }),
      ok: true,
      status: 200,
    } as Response);
    const client = createImeiRemediationClient({
      accessToken: 'token',
      apiBaseUrl: 'https://shop.example.com',
      fetchImpl,
    });

    await expect(
      client.eligibility({
        identifier: '490154203237518',
        lookupId: '11111111-1111-4111-8111-111111111111',
      })
    ).resolves.toMatchObject({ kind: 'eligible', usdtEnabled: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://shop.example.com/api/storefront/imei-remediation/eligibility',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      })
    );
  });

  it('lists customer-safe unlock orders', async () => {
    const fetchImpl = jest.fn<FetchImplementation>().mockResolvedValue({
      json: () =>
        Promise.resolve({ orders: [{ id: 'order-1' }], success: true }),
      ok: true,
      status: 200,
    } as Response);
    const client = createImeiRemediationClient({
      apiBaseUrl: 'https://shop.example.com/',
      fetchImpl,
    });

    await expect(client.list()).resolves.toEqual([{ id: 'order-1' }]);
  });
});
