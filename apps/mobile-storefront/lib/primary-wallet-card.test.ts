import { beforeEach, expect, it, jest } from '@jest/globals';

const mockStorage = new Map<string, string>();
const mockFetchJson = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockGetUser = jest.fn<() => Promise<unknown>>();
const mockSetItem = jest.fn(async (key: string, value: string) => {
  mockStorage.set(key, value);
});
const mockUuid = jest.fn(() => '33333333-3333-4333-8333-333333333333');
const mockCreateApiClient = jest.fn(() => ({ fetchJson: mockFetchJson }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockStorage.get(key) ?? null,
    setItem: mockSetItem,
    removeItem: async (key: string) => {
      mockStorage.delete(key);
    },
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: mockUuid }));
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: mockCreateApiClient,
}));
jest.mock('./supabase', () => ({
  supabase: { auth: { getUser: mockGetUser } },
}));
const { createPrimaryWalletCardFundingClient } =
  require('./primary-wallet-card') as typeof import('./primary-wallet-card');
const scope = {
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  userId: '11111111-1111-4111-8111-111111111111',
};
const operationId = '22222222-2222-4222-8222-222222222222';
const response = {
  operationId,
  amountKobo: 100000,
  currency: 'NGN',
  reference: `pvb-first-primary-${operationId}`,
  status: 'ready',
  authorizationUrl: 'https://checkout.paystack.com/Synthetic123',
};
const start = {
  ...scope,
  amountKobo: 100000,
  consent: {
    version: 'primary-wallet-card-v1',
    oneTimeCharge: true,
    saveCard: false,
  },
  returnTo: '/wallet',
};
beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.clear();
  mockSetItem.mockImplementation(async (key, value) => {
    mockStorage.set(key, value);
  });
  mockFetchJson.mockReset().mockResolvedValue(response);
  mockGetUser.mockResolvedValue({
    data: { user: { id: scope.userId } },
    error: null,
  });
});
it('persists immutable consent and idempotency before POST initialize with authenticated CSRF transport and no goal/BVN', async () => {
  mockFetchJson.mockImplementationOnce(async (input) => {
    expect(mockStorage.size).toBe(1);
    expect(JSON.parse([...mockStorage.values()][0])).toMatchObject({
      idempotencyKey: mockUuid(),
      consent: start.consent,
      operationId: null,
    });
    expect(input).toEqual({
      path: '/api/storefront/customer/wallet/primary-card/initialize',
      method: 'POST',
      includeCsrf: true,
      body: {
        merchantId: scope.merchantId,
        idempotencyKey: mockUuid(),
        amountKobo: 100000,
        consent: start.consent,
      },
    });
    return response;
  });
  expect(
    (await createPrimaryWalletCardFundingClient().start(start)).status
  ).toBe('ready');
  expect(mockStorage.size).toBe(1);
  expect(JSON.parse([...mockStorage.values()][0]).operationId).toBe(
    operationId
  );
});
it('retains the same key across initialization timeout and a cold-client retry', async () => {
  mockFetchJson.mockRejectedValueOnce(new Error('Synthetic timeout'));
  await expect(
    createPrimaryWalletCardFundingClient().start(start)
  ).rejects.toThrow();
  const persisted = [...mockStorage.values()][0];
  await createPrimaryWalletCardFundingClient().start(start);
  const first = mockFetchJson.mock.calls[0][0];
  expect(mockFetchJson.mock.calls[1][0]).toEqual(first);
  expect(JSON.parse(persisted).operationId).toBeNull();
  expect(mockUuid).toHaveBeenCalledTimes(1);
});
it('recovers a known operation after process death using status only and retains custody-pending state', async () => {
  await createPrimaryWalletCardFundingClient().start(start);
  mockFetchJson.mockResolvedValue({
    ...response,
    authorizationUrl: undefined,
    status: 'custody_pending',
  });
  const result = await createPrimaryWalletCardFundingClient().recover({
    ...scope,
    reference: response.reference,
  });
  expect(result.status).toBe('custody_pending');
  expect(mockFetchJson.mock.calls[1][0]).toEqual({
    path: '/api/storefront/customer/wallet/primary-card/status',
    method: 'POST',
    includeCsrf: true,
    body: { merchantId: scope.merchantId, operationId },
  });
  expect(mockStorage.size).toBe(1);
});
it('clears only after authoritative completed custody, never checkout acceptance', async () => {
  const client = createPrimaryWalletCardFundingClient();
  await client.start(start);
  for (const status of [
    'ready',
    'init_unknown',
    'custody_pending',
    'reconciliation_required',
  ]) {
    mockFetchJson.mockResolvedValue({ ...response, status });
    await client.recover(scope);
    expect(mockStorage.size).toBe(1);
  }
  mockFetchJson.mockResolvedValue({
    ...response,
    status: 'completed',
    authorizationUrl: undefined,
  });
  await client.recover(scope);
  expect(mockStorage.size).toBe(0);
});
it('clears an abandoned checkout so a fresh funding can start', async () => {
  const client = createPrimaryWalletCardFundingClient();
  await client.start(start);
  mockFetchJson.mockResolvedValue({
    ...response,
    status: 'abandoned',
    authorizationUrl: undefined,
  });
  expect((await client.recover(scope)).status).toBe('abandoned');
  expect(mockStorage.size).toBe(0);
  mockFetchJson.mockResolvedValue(response);
  await client.start(start);
  expect(mockStorage.size).toBe(1);
});
it('serializes concurrent factory instances so double taps use one initialization then status', async () => {
  await Promise.all([
    createPrimaryWalletCardFundingClient().start(start),
    createPrimaryWalletCardFundingClient().start(start),
  ]);
  expect(mockUuid).toHaveBeenCalledTimes(1);
  expect(
    mockFetchJson.mock.calls.map((call) => (call[0] as { path: string }).path)
  ).toEqual([
    '/api/storefront/customer/wallet/primary-card/initialize',
    '/api/storefront/customer/wallet/primary-card/status',
  ]);
});
it('refuses changed amount or consent while a durable operation is pending', async () => {
  const client = createPrimaryWalletCardFundingClient();
  await client.start(start);
  await expect(client.start({ ...start, amountKobo: 200000 })).rejects.toThrow(
    'different'
  );
  await expect(
    client.start({ ...start, consent: { ...start.consent, saveCard: true } })
  ).rejects.toThrow('different');
  expect(mockFetchJson).toHaveBeenCalledTimes(1);
});
it('blocks unrelated callbacks and response identities without deleting the durable record', async () => {
  const client = createPrimaryWalletCardFundingClient();
  await client.start(start);
  await expect(
    client.recover({
      ...scope,
      reference: 'pvb-first-primary-33333333-3333-4333-8333-333333333333',
    })
  ).rejects.toThrow('callback');
  mockFetchJson.mockResolvedValue({
    ...response,
    operationId: start.userId,
    reference: `pvb-first-primary-${start.userId}`,
  });
  await expect(client.recover(scope)).rejects.toThrow('could not be confirmed');
  expect(mockStorage.size).toBe(1);
});
it('adopts the stored operation when initialize returns a different amount after storage loss', async () => {
  const client = createPrimaryWalletCardFundingClient();
  const result = await client.start({ ...start, amountKobo: 200000 });
  expect(result).toMatchObject({
    adopted: true,
    operationId,
    amountKobo: 100000,
    status: 'ready',
  });
  expect(JSON.parse([...mockStorage.values()][0])).toMatchObject({
    operationId,
    amountKobo: 100000,
  });
  // The adopted record resumes through status polling with its own amount.
  mockFetchJson.mockResolvedValueOnce({ ...response, status: 'completed' });
  const recovered = await client.recover(scope);
  expect(recovered).toMatchObject({ amountKobo: 100000, status: 'completed' });
  expect('adopted' in recovered).toBe(false);
  expect(mockStorage.size).toBe(0);
});
it('keeps the strict amount binding on status polls after adoption', async () => {
  const client = createPrimaryWalletCardFundingClient();
  await client.start({ ...start, amountKobo: 200000 });
  mockFetchJson.mockResolvedValue({ ...response, amountKobo: 99999 });
  await expect(client.recover(scope)).rejects.toThrow('could not be confirmed');
  expect(JSON.parse([...mockStorage.values()][0])).toMatchObject({
    operationId,
    amountKobo: 100000,
  });
});
it('fails closed on storage failure before any provider initialization and preserves malformed records', async () => {
  mockSetItem.mockRejectedValueOnce(new Error('Synthetic storage failure'));
  await expect(
    createPrimaryWalletCardFundingClient().start(start)
  ).rejects.toThrow();
  expect(mockFetchJson).not.toHaveBeenCalled();
  mockStorage.set(
    `@baci_primary_card:${scope.merchantId}:${scope.userId}`,
    'invalid'
  );
  await expect(
    createPrimaryWalletCardFundingClient().start(start)
  ).rejects.toThrow();
  expect(mockStorage.size).toBe(1);
  expect(mockFetchJson).not.toHaveBeenCalled();
});
it('does not recover another account or dispatch after the authenticated account switches', async () => {
  const client = createPrimaryWalletCardFundingClient();
  await client.start(start);
  await expect(
    client.recover({ ...scope, userId: operationId })
  ).rejects.toThrow('No matching');
  mockGetUser.mockResolvedValue({
    data: { user: { id: operationId } },
    error: null,
  });
  await expect(client.recover(scope)).rejects.toThrow('account');
  expect(mockFetchJson).toHaveBeenCalledTimes(1);
  expect(mockStorage.size).toBe(1);
});
it('does not reuse a cached bearer transport when one funding client serves a switched account', async () => {
  const client = createPrimaryWalletCardFundingClient();
  await client.start(start);
  const otherScope = { ...scope, userId: operationId };
  mockGetUser.mockResolvedValue({
    data: { user: { id: otherScope.userId } },
    error: null,
  });
  await client.start({ ...start, ...otherScope });
  expect(mockCreateApiClient).toHaveBeenCalledTimes(2);
  expect(mockStorage.size).toBe(2);
  expect(await client.readPending(scope)).toMatchObject(scope);
  expect(await client.readPending(otherScope)).toMatchObject(otherScope);
});
it('drops only the null-operation placeholder on authoritative not-ready', async () => {
  const client = createPrimaryWalletCardFundingClient();
  mockFetchJson.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'PRIMARY_CARD_NOT_READY' })
  );
  await expect(client.start(start)).rejects.toMatchObject({
    code: 'PRIMARY_CARD_NOT_READY',
  });
  expect(mockStorage.size).toBe(0);
  expect(await client.readPending(scope)).toBeNull();
});
it('keeps the placeholder for ambiguous failures so recovery can retry', async () => {
  const client = createPrimaryWalletCardFundingClient();
  mockFetchJson.mockRejectedValueOnce(new Error('transport exploded'));
  await expect(client.start(start)).rejects.toThrow('transport exploded');
  expect(mockStorage.size).toBe(1);
  await expect(client.recover(scope)).resolves.toMatchObject({
    status: 'ready',
  });
});
it('lets a slow scope finish without blocking another scope', async () => {
  const client = createPrimaryWalletCardFundingClient();
  const otherScope = { ...scope, userId: operationId };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockFetchJson.mockImplementationOnce(async () => {
    await gate;
    return response;
  });
  // Scope A starts first and hangs in transport; scope B authenticates as
  // its own user and must still complete while A is stuck.
  mockGetUser
    .mockResolvedValueOnce({
      data: { user: { id: scope.userId } },
      error: null,
    })
    .mockResolvedValue({
      data: { user: { id: otherScope.userId } },
      error: null,
    });
  const pendingA = client.start(start);
  await client.start({ ...start, ...otherScope });
  release();
  await expect(pendingA).resolves.toMatchObject({ status: 'ready' });
  expect(mockFetchJson).toHaveBeenCalledTimes(2);
});
