import { describe, expect, it, vi } from 'vitest';
import {
  discoverGoogleAdsCustomerIds,
  GOOGLE_ADS_MANAGER_DISCOVERY_LIMIT,
} from './account-discovery';

describe('Google Ads account discovery traversal', () => {
  it('discovers nested clients while preserving direct customers', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith('/customers/1111111111/googleAds:searchStream')) {
          return new Response(
            JSON.stringify([
              {
                results: [
                  {
                    customerClient: {
                      clientCustomer: 'customers/2222222222',
                      manager: true,
                    },
                  },
                  {
                    customerClient: {
                      clientCustomer: 'customers/3333333333',
                      manager: false,
                    },
                  },
                ],
              },
            ])
          );
        }
        return new Response(
          JSON.stringify([
            {
              results: [
                {
                  customerClient: {
                    clientCustomer: 'customers/4444444444',
                    manager: false,
                  },
                },
              ],
            },
          ])
        );
      });

    await expect(
      discoverGoogleAdsCustomerIds({
        apiRoot: 'https://googleads.googleapis.com/v25',
        createError: (code, status) => new Error(`${code}:${status ?? ''}`),
        directCustomerIds: ['1111111111'],
        fetchImpl,
        headers: { Authorization: 'Bearer access-token' },
      })
    ).resolves.toEqual(['3333333333', '4444444444']);
  });

  it('does not return an accessible manager account as a selectable customer', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            results: [
              {
                customerClient: {
                  clientCustomer: 'customers/2222222222',
                  manager: false,
                },
              },
            ],
          },
        ])
      )
    );

    await expect(
      discoverGoogleAdsCustomerIds({
        apiRoot: 'https://googleads.googleapis.com/v25',
        createError: (code, status) => new Error(`${code}:${status ?? ''}`),
        directCustomerIds: ['1111111111'],
        fetchImpl,
        headers: { Authorization: 'Bearer access-token' },
      })
    ).resolves.toEqual(['2222222222']);
  });

  it('treats only an explicit non-manager provider error as a leaf account', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 400,
            details: [
              {
                errors: [
                  {
                    errorCode: { customerNotManager: 'CUSTOMER_NOT_MANAGER' },
                    message: 'The customer is not a manager account.',
                  },
                ],
              },
            ],
          },
        }),
        { status: 400 }
      )
    );

    await expect(
      discoverGoogleAdsCustomerIds({
        apiRoot: 'https://googleads.googleapis.com/v25',
        createError: (code, status) => new Error(`${code}:${status ?? ''}`),
        directCustomerIds: ['1111111111'],
        fetchImpl,
        headers: { Authorization: 'Bearer access-token' },
      })
    ).resolves.toEqual(['1111111111']);
  });

  it('does not treat an inaccessible customer as a non-manager leaf', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 400,
            details: [
              {
                errors: [
                  {
                    errorCode: { authorizationError: 'USER_PERMISSION_DENIED' },
                    message: "User doesn't have permission to access customer.",
                  },
                ],
              },
            ],
          },
        }),
        { status: 400 }
      )
    );
    const createError = (code: string, status?: number) =>
      Object.assign(new Error(code), { code, status });

    await expect(
      discoverGoogleAdsCustomerIds({
        apiRoot: 'https://googleads.googleapis.com/v25',
        createError,
        directCustomerIds: ['1111111111'],
        fetchImpl,
        headers: { Authorization: 'Bearer access-token' },
      })
    ).rejects.toMatchObject({
      code: 'GOOGLE_ADS_MANAGER_ACCOUNT_DISCOVERY_FAILED',
      status: 400,
    });
  });

  it('does not treat a malformed 404 response as a non-manager leaf', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('not-json', { status: 404 }));
    const createError = (code: string, status?: number) =>
      Object.assign(new Error(code), { code, status });

    await expect(
      discoverGoogleAdsCustomerIds({
        apiRoot: 'https://googleads.googleapis.com/v25',
        createError,
        directCustomerIds: ['1111111111'],
        fetchImpl,
        headers: { Authorization: 'Bearer access-token' },
      })
    ).rejects.toMatchObject({
      code: 'GOOGLE_ADS_MANAGER_ACCOUNT_DISCOVERY_FAILED',
      status: 404,
    });
  });

  it('rejects a malformed manager batch instead of returning partial accounts', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify([{ notResults: [] }])));
    const createError = (code: string, status?: number) =>
      Object.assign(new Error(code), { code, status });

    await expect(
      discoverGoogleAdsCustomerIds({
        apiRoot: 'https://googleads.googleapis.com/v25',
        createError,
        directCustomerIds: ['1111111111'],
        fetchImpl,
        headers: { Authorization: 'Bearer access-token' },
      })
    ).rejects.toMatchObject({
      code: 'GOOGLE_ADS_MANAGER_ACCOUNT_DISCOVERY_RESPONSE_INVALID',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('returns an explicit manager limit error instead of a partial list', async () => {
    const directCustomerIds = Array.from({ length: 21 }, (_, index) =>
      String(1_000_000_000 + index)
    );
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(JSON.stringify([])));

    await expect(
      discoverGoogleAdsCustomerIds({
        apiRoot: 'https://googleads.googleapis.com/v25',
        createError: (code, status) => {
          const error = new Error(code) as Error & {
            code?: string;
            status?: number;
          };
          error.code = code;
          error.status = status;
          return error;
        },
        directCustomerIds,
        fetchImpl,
        headers: { Authorization: 'Bearer access-token' },
      })
    ).rejects.toMatchObject({ code: GOOGLE_ADS_MANAGER_DISCOVERY_LIMIT });
    expect(fetchImpl).toHaveBeenCalledTimes(20);
  });
});
