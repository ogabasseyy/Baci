import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockStorage = new Map<string, string>();
const mockFetchJson = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockGetUser = jest.fn<() => Promise<unknown>>();
const mockSetItem = jest.fn(async (key: string, value: string) => {
  mockStorage.set(key, value);
});
const mockUuid = jest.fn(() => '33333333-3333-4333-8333-333333333333');
const mockWarn = jest.fn<(message: string, ...args: unknown[]) => void>();
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
jest.mock('./logger', () => ({
  createLogger: () => ({ warn: mockWarn }),
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
// The raw peek is a local storage read: no server call, so it behaves the
// same with PiggyVest off.
describe('peekRaw with the server keeping PiggyVest off', () => {
  it('reports nothing saved without calling the server', async () => {
    const client = createPrimaryWalletCardFundingClient();

    await expect(client.peekRaw(scope)).resolves.toBeNull();
    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});

describe('bugfix: purchase top-up check raced a PiggyVest card start', () => {
  it('bugfix: peekRaw waits for a start in flight instead of reading an empty slot', async () => {
    // Arrange: a primary card start whose initialize request is still pending.
    let releaseRequest: (value: unknown) => void = () => undefined;
    let requested: () => void = () => undefined;
    const requestSent = new Promise<void>((resolve) => {
      requested = resolve;
    });
    mockFetchJson.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseRequest = resolve;
          requested();
        })
    );
    const client = createPrimaryWalletCardFundingClient();
    const started = client.start(start);

    // Act: a purchase top-up inspects the scope while the start is running.
    const peeked = client.peekRaw(scope);
    await requestSent;
    releaseRequest(response);
    await started;

    // Assert: the inspection sees the persisted placeholder, not nothing.
    expect(await peeked).not.toBeNull();
  });
});
