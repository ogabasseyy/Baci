import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestPiggyvestStagingJson } from './staging-json-request';
import { retrievePiggyvestStagingTransactionList } from './transaction-list';

vi.mock('./staging-json-request', () => ({
  requestPiggyvestStagingJson: vi.fn(),
}));
const identity = {
  environment: 'staging',
  integrationId: '00000000-0000-4000-8000-000000000001',
  merchantId: '00000000-0000-4000-8000-000000000002',
  customerId: '00000000-0000-4000-8000-000000000003',
  goalId: '00000000-0000-4000-8000-000000000004',
  providerWalletId: 'wallet',
  providerCustomerId: 'customer',
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
  id: 'wallet',
  business_id: 'synthetic-business',
  currency: 'NGN',
  status: 'active',
  balance: 0,
};
const row = {
  id: 'transaction',
  amount: 12345,
  type: 'credit',
  status: 'successful',
  category: 'p2p',
  description: 'Synthetic',
  wallet_id: 'wallet',
  wallet_type: 'api',
  created_at: '2026-09-12T00:00:00Z',
  third_party_reference: 'synthetic-ref',
};
const pageInfo = { hasNextPage: true, endCursor: 'next', previousCursor: null };
const response = (edges: unknown[] = [row]) => ({
  status: true,
  data: { edges, pageInfo },
});
function options() {
  return {
    configuration,
    query: { limit: 2 },
    resolveTrustedIdentity: vi.fn(async () => identity),
    execute: vi.fn(async () => ({ rows: [mapping] })),
    fetchImplementation: vi.fn<typeof fetch>(),
  };
}
beforeEach(() => {
  vi.mocked(requestPiggyvestStagingJson)
    .mockReset()
    .mockResolvedValueOnce({ status: true, data: wallet })
    .mockResolvedValueOnce(
      response([{ ...row, fee: 123, balance: 999, secret: 'discard' }])
    );
});
describe('mapped wallet transaction list', () => {
  it('uses the actual bounded transport with synthetic fetch only', async () => {
    const actual = await vi.importActual<
      typeof import('./staging-json-request')
    >('./staging-json-request');
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockImplementation(actual.requestPiggyvestStagingJson);
    const input = options();
    input.fetchImplementation
      .mockResolvedValueOnce(Response.json({ status: true, data: wallet }))
      .mockResolvedValueOnce(Response.json(response()));
    expect(
      (await retrievePiggyvestStagingTransactionList(input)).edges
    ).toEqual([row]);
    expect(input.fetchImplementation).toHaveBeenCalledTimes(2);
  });
  it('rejects oversized bytes through the existing transport', async () => {
    const actual = await vi.importActual<
      typeof import('./staging-json-request')
    >('./staging-json-request');
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockImplementation(actual.requestPiggyvestStagingJson);
    const input = options();
    input.fetchImplementation
      .mockResolvedValueOnce(Response.json({ status: true, data: wallet }))
      .mockResolvedValueOnce(
        Response.json({ ...response(), padding: 'x'.repeat(65_536) })
      );
    await expect(
      retrievePiggyvestStagingTransactionList(input)
    ).rejects.toMatchObject({ code: 'LIST_REQUEST_FAILED' });
    expect(input.fetchImplementation).toHaveBeenCalledTimes(2);
  });
  it.each([
    null,
    { ...identity, customerId: identity.goalId },
    { ...identity, integrationId: identity.goalId },
    { ...identity, wallet_id: 'injected' },
  ])('rejects invalid trusted scope before mapping', async (trusted) => {
    const input = options();
    await expect(
      retrievePiggyvestStagingTransactionList({
        ...input,
        resolveTrustedIdentity: async () => trusted,
      })
    ).rejects.toMatchObject({ code: 'INVALID_IDENTITY' });
    expect(input.execute).not.toHaveBeenCalled();
    expect(requestPiggyvestStagingJson).not.toHaveBeenCalled();
  });
  it.each([
    { id: 'other' },
    { business_id: 'other' },
    { currency: 'USD' },
  ])('requires verified provider wallet scope', async (override) => {
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockResolvedValueOnce({
        status: true,
        data: { ...wallet, ...override },
      });
    await expect(
      retrievePiggyvestStagingTransactionList(options())
    ).rejects.toMatchObject({ code: 'WALLET_VERIFICATION_FAILED' });
    expect(requestPiggyvestStagingJson).toHaveBeenCalledOnce();
  });
  it('returns an empty observation page without inventing a total', async () => {
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockResolvedValueOnce({ status: true, data: wallet })
      .mockResolvedValueOnce({
        status: true,
        data: {
          edges: [],
          pageInfo: {
            hasNextPage: false,
            endCursor: null,
            previousCursor: null,
          },
        },
      });
    await expect(
      retrievePiggyvestStagingTransactionList(options())
    ).resolves.toEqual({
      monetaryUnits: 'kobo',
      spendable: false,
      financialEffects: 'UNKNOWN',
      edges: [],
      pageInfo: { hasNextPage: false, endCursor: null, previousCursor: null },
    });
  });
  it('reads one uncollapsed observation page without summing or inferring finality', async () => {
    const input = options();
    await expect(
      retrievePiggyvestStagingTransactionList(input)
    ).resolves.toEqual({
      monetaryUnits: 'kobo',
      spendable: false,
      financialEffects: 'UNKNOWN',
      edges: [row],
      pageInfo,
    });
    expect(input.execute).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('resolve_wallet_mapping'),
      [identity.integrationId, 'wallet', 'customer']
    );
    expect(requestPiggyvestStagingJson).toHaveBeenCalledTimes(2);
    expect(requestPiggyvestStagingJson).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/transaction?wallet_id=wallet&limit=2&collapse_batch=0',
      })
    );
  });
  it.each([
    'pending',
    'successful',
    'failed',
    'partial',
  ])('preserves %s status', async (status) => {
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockResolvedValueOnce({ status: true, data: wallet })
      .mockResolvedValueOnce(response([{ ...row, status }]));
    expect(
      (await retrievePiggyvestStagingTransactionList(options())).edges[0].status
    ).toBe(status);
  });
  it.each([
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    '123',
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects unsafe kobo value %s', async (amount) => {
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockResolvedValueOnce({ status: true, data: wallet })
      .mockResolvedValueOnce(response([{ ...row, amount }]));
    await expect(
      retrievePiggyvestStagingTransactionList(options())
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it.each([
    { wallet_id: 'other' },
    { status: 'success' },
    { type: 'unknown' },
    { batch_total_split: 2 },
  ])('rejects cross-wallet, malformed or collapsed rows', async (override) => {
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockResolvedValueOnce({ status: true, data: wallet })
      .mockResolvedValueOnce(response([row, { ...row, ...override }]));
    await expect(
      retrievePiggyvestStagingTransactionList(options())
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it.each([
    { actualProjectId: 'other' },
    { provisioningApproved: false },
    { apiBaseUrl: 'https://api.piggyvest.business' },
  ])('rejects unsafe deployment before dependencies', async (override) => {
    const input = options();
    await expect(
      retrievePiggyvestStagingTransactionList({
        ...input,
        configuration: { ...configuration, ...override },
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    expect(input.execute).not.toHaveBeenCalled();
    expect(requestPiggyvestStagingJson).not.toHaveBeenCalled();
  });
  it.each([
    'merchant_id',
    'customer_id',
    'goal_id',
  ] as const)('rejects mismatched mapping %s', async (field) => {
    const input = options();
    input.execute.mockResolvedValue({
      rows: [{ ...mapping, [field]: identity.integrationId }],
    });
    await expect(
      retrievePiggyvestStagingTransactionList(input)
    ).rejects.toMatchObject({ code: 'INVALID_MAPPING' });
    expect(requestPiggyvestStagingJson).not.toHaveBeenCalled();
  });
  it('rejects over-limit responses and repeated next cursors', async () => {
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockResolvedValueOnce({ status: true, data: wallet })
      .mockResolvedValueOnce(response([row, row, row]));
    await expect(
      retrievePiggyvestStagingTransactionList(options())
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockResolvedValueOnce({ status: true, data: wallet })
      .mockResolvedValueOnce(response());
    await expect(
      retrievePiggyvestStagingTransactionList({
        ...options(),
        query: { cursor: 'next' },
      })
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('redacts errors without retries', async () => {
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockResolvedValueOnce({ status: true, data: wallet })
      .mockRejectedValueOnce(new Error('private detail'));
    await expect(
      retrievePiggyvestStagingTransactionList(options())
    ).rejects.toMatchObject({
      message: 'PiggyVest transaction list failed: LIST_REQUEST_FAILED.',
    });
    expect(requestPiggyvestStagingJson).toHaveBeenCalledTimes(2);
  });
});
