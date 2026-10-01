import { describe, expect, it, vi } from 'vitest';
import {
  fetchGoogleAdsDailySpend,
  GOOGLE_ADS_ACCOUNT_DISCOVERY_LIMIT,
  GOOGLE_ADS_MANAGER_DEPTH_LIMIT,
  GOOGLE_ADS_MANAGER_DISCOVERY_LIMIT,
  getGoogleAdsApiRoot,
  listGoogleAdsAccessibleCustomerIds,
  refreshGoogleAdsAccessToken,
} from './provider';

const reportingConfig = { developerToken: 'developer-token' };

describe('Google Ads provider client', () => {
  it('uses the current default API version and parses accessible accounts', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => {
        const isAccessibleCustomersRequest = String(input).includes(
          '/customers:listAccessibleCustomers'
        );
        return new Response(
          JSON.stringify(
            isAccessibleCustomersRequest
              ? {
                  resourceNames: [
                    'customers/1234567890',
                    'customers/not-an-id',
                  ],
                }
              : {
                  error: {
                    details: [
                      {
                        errors: [
                          {
                            errorCode: {
                              customerNotManager: 'CUSTOMER_NOT_MANAGER',
                            },
                            message: 'The customer is not a manager account.',
                          },
                        ],
                      },
                    ],
                  },
                }
          ),
          { status: isAccessibleCustomersRequest ? 200 : 400 }
        );
      });

    await expect(
      listGoogleAdsAccessibleCustomerIds(
        'access-token',
        reportingConfig,
        fetchImpl
      )
    ).resolves.toEqual(['1234567890']);
    expect(getGoogleAdsApiRoot()).toContain('/v25');
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/v25/customers:listAccessibleCustomers'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'developer-token': 'developer-token',
        }),
      })
    );
  });

  it('discovers customers nested below accessible manager accounts', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith('/customers:listAccessibleCustomers')) {
          return new Response(
            JSON.stringify({ resourceNames: ['customers/1111111111'] }),
            { status: 200 }
          );
        }
        if (url.includes('/customers/1111111111/googleAds:searchStream')) {
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
            ]),
            { status: 200 }
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
          ]),
          { status: 200 }
        );
      });

    await expect(
      listGoogleAdsAccessibleCustomerIds(
        'access-token',
        reportingConfig,
        fetchImpl
      )
    ).resolves.toEqual(['3333333333', '4444444444']);
    const hierarchyCall = fetchImpl.mock.calls.find(([input]) =>
      String(input).includes('/customers/1111111111/googleAds:searchStream')
    );
    expect(hierarchyCall?.[1]).toMatchObject({
      body: expect.stringContaining('FROM customer_client'),
      method: 'POST',
    });
  });

  it('rejects a malformed accessible-customer response instead of reporting no accounts', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await expect(
      listGoogleAdsAccessibleCustomerIds(
        'access-token',
        reportingConfig,
        fetchImpl
      )
    ).rejects.toMatchObject({
      code: 'GOOGLE_ADS_ACCOUNT_DISCOVERY_RESPONSE_INVALID',
    });
  });

  it('fails instead of returning a partial set when the manager-node cap leaves work queued', async () => {
    const directIds = Array.from({ length: 30 }, (_, index) =>
      String(1_000_000_000 + index)
    );
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) =>
      String(input).endsWith('/customers:listAccessibleCustomers')
        ? new Response(
            JSON.stringify({
              resourceNames: directIds.map((id) => `customers/${id}`),
            })
          )
        : new Response(JSON.stringify([]))
    );

    await expect(
      listGoogleAdsAccessibleCustomerIds(
        'access-token',
        reportingConfig,
        fetchImpl
      )
    ).rejects.toMatchObject({
      code: GOOGLE_ADS_MANAGER_DISCOVERY_LIMIT,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(21);
  });

  it('fails instead of returning a partial set when a manager is beyond the depth cap', async () => {
    const chain = Array.from({ length: 7 }, (_, index) =>
      String(1_000_000_000 + index)
    );
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith('/customers:listAccessibleCustomers')) {
          return new Response(
            JSON.stringify({ resourceNames: [`customers/${chain[0]}`] })
          );
        }
        const customerId = url.match(
          /customers\/(\d+)\/googleAds:searchStream/
        )?.[1];
        const index = customerId ? chain.indexOf(customerId) : -1;
        const next = index >= 0 ? chain[index + 1] : undefined;
        return new Response(
          JSON.stringify(
            next
              ? [
                  {
                    results: [
                      {
                        customerClient: {
                          clientCustomer: `customers/${next}`,
                          manager: true,
                        },
                      },
                    ],
                  },
                ]
              : []
          )
        );
      });

    await expect(
      listGoogleAdsAccessibleCustomerIds(
        'access-token',
        reportingConfig,
        fetchImpl
      )
    ).rejects.toMatchObject({ code: GOOGLE_ADS_MANAGER_DEPTH_LIMIT });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('fails instead of returning a partial set when the customer cap leaves manager work queued', async () => {
    const leafClients = Array.from({ length: 999 }, (_, index) => ({
      customerClient: {
        clientCustomer: `customers/${String(2_000_000_000 + index)}`,
        manager: false,
      },
    }));
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) =>
      String(input).endsWith('/customers:listAccessibleCustomers')
        ? new Response(
            JSON.stringify({ resourceNames: ['customers/1111111111'] })
          )
        : new Response(
            JSON.stringify([
              {
                results: [
                  ...leafClients,
                  {
                    customerClient: {
                      clientCustomer: 'customers/9999999999',
                      manager: true,
                    },
                  },
                ],
              },
            ])
          )
    );

    await expect(
      listGoogleAdsAccessibleCustomerIds(
        'access-token',
        reportingConfig,
        fetchImpl
      )
    ).rejects.toMatchObject({ code: GOOGLE_ADS_ACCOUNT_DISCOVERY_LIMIT });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refreshes an access token without exposing the refresh token in the result', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: 'new-access', expires_in: 3600 }),
        {
          status: 200,
        }
      )
    );

    const result = await refreshGoogleAdsAccessToken(
      {
        clientId: 'client',
        clientSecret: 'secret',
        refreshToken: 'refresh-token',
      },
      fetchImpl
    );

    expect(result.accessToken).toBe('new-access');
    expect(JSON.stringify(result)).not.toContain('refresh-token');
  });

  it('sends a GAQL daily spend query and parses rows', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            results: [
              {
                customer: { currencyCode: 'NGN', id: '1234567890' },
                metrics: {
                  clicks: '1',
                  conversions: '0',
                  costMicros: '2000000',
                  impressions: '10',
                },
                segments: { date: '2026-08-20' },
              },
            ],
          },
        ]),
        { status: 200 }
      )
    );

    const rows = await fetchGoogleAdsDailySpend(
      {
        accessToken: 'access-token',
        customerId: '1234567890',
        endDate: '2026-08-20',
        reportingConfig,
        startDate: '2026-08-20',
      },
      fetchImpl
    );

    expect(rows[0]).toMatchObject({
      currencyCode: 'NGN',
      spendMicros: '2000000',
    });
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      '/customers/1234567890/googleAds:searchStream'
    );
  });
});
