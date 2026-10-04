import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retrievePiggyvestStagingAccruedInterest } from './accrued-interest';
import { requestPiggyvestStagingJson } from './staging-json-request';

vi.mock('./staging-json-request', () => ({
  requestPiggyvestStagingJson: vi.fn(),
}));

const identity = {
  environment: 'staging',
  integrationId: '00000000-0000-4000-8000-000000000001',
  merchantId: '00000000-0000-4000-8000-000000000002',
  customerId: '00000000-0000-4000-8000-000000000003',
  goalId: '00000000-0000-4000-8000-000000000004',
  providerWalletId: 'synthetic-wallet',
  providerCustomerId: 'synthetic-customer',
};
const configuration = {
  apiSecret: 'synthetic-secret',
  expectedBusinessId: 'synthetic-business',
  environment: 'staging',
  integrationId: identity.integrationId,
  expectedMerchantId: identity.merchantId,
  expectedProjectId: 'synthetic-project',
  actualProjectId: 'synthetic-project',
  allowlistedCustomerIds: [identity.customerId],
  provisioningApproved: true,
  syntheticIdentityApproved: true,
  fingerprintKey: 'synthetic-fingerprint-key-0000000000',
};
const mapping = {
  merchant_id: identity.merchantId,
  customer_id: identity.customerId,
  goal_id: identity.goalId,
};
const wallet = {
  id: identity.providerWalletId,
  business_id: configuration.expectedBusinessId,
  currency: 'NGN',
  status: 'active',
  balance: 0,
};
const edge = {
  id: 'synthetic-interest',
  business_id: configuration.expectedBusinessId,
  wallet_id: identity.providerWalletId,
  wallet_name: 'Synthetic wallet',
  amount: 0.123,
  balance: 123.456,
  percentage: 8,
  interest_date: '2026-09-01',
  interest_date_timestamp: '1788220800',
  interest_type: 'original',
  differential_wallet_id: null,
  differential_wallet_name: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};
const pageInfo = {
  hasNextPage: true,
  endCursor: 'opaque +/&=?',
  previousCursor: null,
};
const query = { start_date: '2026-09-01', end_date: '2026-09-12', limit: 2 };
function response(edges: unknown[] = [edge], pagination = pageInfo) {
  return {
    status: true,
    data: { paginatedPayload: { edges, pageInfo: pagination } },
  };
}
function dependencies() {
  return {
    configuration,
    query,
    resolveTrustedIdentity: vi.fn(async () => identity),
    execute: vi.fn(async () => ({ rows: [mapping] })),
    fetchImplementation: vi.fn<typeof fetch>(),
  };
}
beforeEach(() => {
  vi.mocked(requestPiggyvestStagingJson)
    .mockReset()
    .mockResolvedValueOnce({ status: true, data: wallet })
    .mockResolvedValueOnce(response([{ ...edge, private_field: 'discard' }]));
});

describe('retrievePiggyvestStagingAccruedInterest', () => {
  it('rejects a continuation cursor that repeats the requested cursor', async () => {
    await expect(
      retrievePiggyvestStagingAccruedInterest({
        ...dependencies(),
        query: { ...query, cursor: pageInfo.endCursor },
      })
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(requestPiggyvestStagingJson).toHaveBeenCalledTimes(2);
  });

  it('returns one projected observation page without interpreting money or following cursors', async () => {
    const options = dependencies();
    await expect(
      retrievePiggyvestStagingAccruedInterest(options)
    ).resolves.toEqual({
      monetaryUnits: 'unconfirmed',
      spendable: false,
      edges: [edge],
      pageInfo,
    });
    expect(options.execute).toHaveBeenCalledExactlyOnceWith(
      'SELECT merchant_id, customer_id, goal_id FROM piggyvest_staging.resolve_wallet_mapping($1::uuid, $2::text, $3::text)',
      [
        identity.integrationId,
        identity.providerWalletId,
        identity.providerCustomerId,
      ]
    );
    expect(requestPiggyvestStagingJson).toHaveBeenCalledTimes(2);
    expect(requestPiggyvestStagingJson).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/wallet/interests/accrued/synthetic-wallet?start_date=2026-09-01&end_date=2026-09-12&limit=2&interest_type=original',
      })
    );
  });

  it('serializes an opaque cursor canonically and permits differential observations', async () => {
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockResolvedValueOnce({ status: true, data: wallet })
      .mockResolvedValueOnce(
        response(
          [
            {
              ...edge,
              interest_type: 'differential',
              differential_wallet_id: 'source-wallet',
              differential_wallet_name: 'Source',
            },
          ],
          { ...pageInfo, endCursor: 'next-cursor' }
        )
      );
    const result = await retrievePiggyvestStagingAccruedInterest({
      ...dependencies(),
      query: {
        ...query,
        cursor: pageInfo.endCursor,
        interest_type: 'differential',
      },
    });
    expect(result.edges[0].interest_type).toBe('differential');
    expect(requestPiggyvestStagingJson).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: '/api/v1/wallet/interests/accrued/synthetic-wallet?start_date=2026-09-01&end_date=2026-09-12&limit=2&interest_type=differential&cursor=opaque+%2B%2F%26%3D%3F',
      })
    );
  });

  it.each([
    'business_id',
    'wallet_id',
    'interest_type',
  ] as const)('rejects a mismatched %s even in a later row', async (field) => {
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockResolvedValueOnce({ status: true, data: wallet })
      .mockResolvedValueOnce(
        response([
          edge,
          {
            ...edge,
            [field]: field === 'interest_type' ? 'differential' : 'other',
          },
        ])
      );
    await expect(
      retrievePiggyvestStagingAccruedInterest(dependencies())
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([
    { actualProjectId: 'other' },
    { expectedBusinessId: ' ' },
    { environment: 'production' },
    { provisioningApproved: false },
    { syntheticIdentityApproved: false },
    { apiBaseUrl: 'https://api.piggyvest.business' },
  ])('rejects unsafe configuration before dependencies', async (override) => {
    const options = dependencies();
    await expect(
      retrievePiggyvestStagingAccruedInterest({
        ...options,
        configuration: { ...configuration, ...override },
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    expect(options.resolveTrustedIdentity).not.toHaveBeenCalled();
    expect(options.execute).not.toHaveBeenCalled();
    expect(requestPiggyvestStagingJson).not.toHaveBeenCalled();
  });

  it.each([
    'merchant_id',
    'customer_id',
    'goal_id',
  ] as const)('rejects a mismatched mapping %s before requests', async (field) => {
    const options = dependencies();
    options.execute.mockResolvedValue({
      rows: [{ ...mapping, [field]: identity.integrationId }],
    });
    await expect(
      retrievePiggyvestStagingAccruedInterest(options)
    ).rejects.toMatchObject({ code: 'INVALID_MAPPING' });
    expect(requestPiggyvestStagingJson).not.toHaveBeenCalled();
  });

  it.each([
    { integrationId: identity.goalId },
    { merchantId: identity.goalId },
    { customerId: identity.goalId },
    { environment: 'production' },
    { goalId: undefined },
  ])('rejects an untrusted identity before mapping', async (override) => {
    const options = dependencies();
    await expect(
      retrievePiggyvestStagingAccruedInterest({
        ...options,
        resolveTrustedIdentity: async () => ({ ...identity, ...override }),
      })
    ).rejects.toMatchObject({ code: 'INVALID_IDENTITY' });
    expect(options.execute).not.toHaveBeenCalled();
    expect(requestPiggyvestStagingJson).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'other' },
    { business_id: 'other' },
    { status: 'inactive' },
    { currency: 'USD' },
  ])('requires verified active wallet %j', async (override) => {
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockResolvedValueOnce({
        status: true,
        data: { ...wallet, ...override },
      });
    await expect(
      retrievePiggyvestStagingAccruedInterest(dependencies())
    ).rejects.toMatchObject({ code: 'WALLET_VERIFICATION_FAILED' });
    expect(requestPiggyvestStagingJson).toHaveBeenCalledOnce();
  });

  it.each([
    response([edge, edge, edge]),
    response([{ ...edge, amount: '1' }]),
    response([{ ...edge, balance: Number.POSITIVE_INFINITY }]),
    { status: false },
    response(Array.from({ length: 101 }, () => edge)),
  ])('rejects malformed or excessive responses', async (payload) => {
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockResolvedValueOnce({ status: true, data: wallet })
      .mockResolvedValueOnce(payload);
    await expect(
      retrievePiggyvestStagingAccruedInterest(dependencies())
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('returns an empty page without inventing balances', async () => {
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockResolvedValueOnce({ status: true, data: wallet })
      .mockResolvedValueOnce(response([]));
    expect(
      (await retrievePiggyvestStagingAccruedInterest(dependencies())).edges
    ).toEqual([]);
  });

  it('redacts provider failure without retrying', async () => {
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockResolvedValueOnce({ status: true, data: wallet })
      .mockRejectedValueOnce(new Error('private provider body'));
    await expect(
      retrievePiggyvestStagingAccruedInterest(dependencies())
    ).rejects.toMatchObject({
      message:
        'PiggyVest staging accrued interest failed: INTEREST_REQUEST_FAILED.',
    });
    expect(requestPiggyvestStagingJson).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid query before identity or mapping resolution', async () => {
    const options = dependencies();
    await expect(
      retrievePiggyvestStagingAccruedInterest({
        ...options,
        query: { ...query, limit: 101 },
      })
    ).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    expect(options.resolveTrustedIdentity).not.toHaveBeenCalled();
    expect(options.execute).not.toHaveBeenCalled();
    expect(requestPiggyvestStagingJson).not.toHaveBeenCalled();
  });

  it('redacts resolver and database errors', async () => {
    const options = dependencies();
    options.resolveTrustedIdentity.mockRejectedValueOnce(
      new Error('private auth')
    );
    await expect(
      retrievePiggyvestStagingAccruedInterest(options)
    ).rejects.toMatchObject({ code: 'INVALID_IDENTITY' });
    options.execute.mockRejectedValueOnce(new Error('private database'));
    await expect(
      retrievePiggyvestStagingAccruedInterest(options)
    ).rejects.toMatchObject({ code: 'INVALID_MAPPING' });
    expect(requestPiggyvestStagingJson).not.toHaveBeenCalled();
  });

  it('uses the real bounded request helper with synthetic fetch only', async () => {
    const actual = await vi.importActual<
      typeof import('./staging-json-request')
    >('./staging-json-request');
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockImplementation(actual.requestPiggyvestStagingJson);
    const options = dependencies();
    options.fetchImplementation
      .mockResolvedValueOnce(Response.json({ status: true, data: wallet }))
      .mockResolvedValueOnce(Response.json(response()));
    await expect(
      retrievePiggyvestStagingAccruedInterest(options)
    ).resolves.toMatchObject({ edges: [edge], spendable: false });
    expect(options.fetchImplementation).toHaveBeenCalledTimes(2);
    expect(options.fetchImplementation).toHaveBeenLastCalledWith(
      'https://staging.piggyvest.business/api/v1/wallet/interests/accrued/synthetic-wallet?start_date=2026-09-01&end_date=2026-09-12&limit=2&interest_type=original',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
      })
    );
  });

  it('enforces the real transport response byte bound', async () => {
    const actual = await vi.importActual<
      typeof import('./staging-json-request')
    >('./staging-json-request');
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockImplementation(actual.requestPiggyvestStagingJson);
    const options = dependencies();
    options.fetchImplementation
      .mockResolvedValueOnce(Response.json({ status: true, data: wallet }))
      .mockResolvedValueOnce(
        Response.json({ ...response(), padding: 'x'.repeat(65_536) })
      );
    await expect(
      retrievePiggyvestStagingAccruedInterest(options)
    ).rejects.toMatchObject({ code: 'INTEREST_REQUEST_FAILED' });
    expect(options.fetchImplementation).toHaveBeenCalledTimes(2);
  });
});
