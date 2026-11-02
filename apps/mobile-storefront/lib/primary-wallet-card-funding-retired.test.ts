import { beforeEach, expect, it, jest } from '@jest/globals';

// The server permanently answers primary-card initialize with 410
// PRIMARY_CARD_FUNDING_RETIRED. That answer comes before any reservation,
// so it must release a saved placeholder that never learned its operation
// ID (left by an earlier timed-out initialize) instead of pinning the
// account to a checkout that can never start.
const mockStorage = new Map<string, string>();
const mockFetchJson = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockGetUser = jest.fn<() => Promise<unknown>>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockStorage.set(key, value);
    },
    removeItem: async (key: string) => {
      mockStorage.delete(key);
    },
  },
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => '33333333-3333-4333-8333-333333333333',
}));
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({ fetchJson: mockFetchJson }),
}));
jest.mock('./logger', () => ({
  createLogger: () => ({ warn: jest.fn() }),
}));
jest.mock('./supabase', () => ({
  supabase: { auth: { getUser: mockGetUser } },
}));
const { createPrimaryWalletCardFundingClient } =
  require('./primary-wallet-card') as typeof import('./primary-wallet-card');
const { isPrimaryWalletNotReady, rollbackObservedCapabilityOnNotReady } =
  require('./piggyvest-primary-capability') as typeof import('./piggyvest-primary-capability');
const {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
  readObservedPiggyvestPrimaryCapability,
} =
  require('./piggyvest-primary-capability-cache') as typeof import('./piggyvest-primary-capability-cache');

const scope = {
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  userId: '11111111-1111-4111-8111-111111111111',
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
const retired = () =>
  Object.assign(new Error('retired'), {
    code: 'PRIMARY_CARD_FUNDING_RETIRED',
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.clear();
  clearObservedPiggyvestPrimaryCapability();
  mockGetUser.mockResolvedValue({
    data: { user: { id: scope.userId } },
    error: null,
  });
});

it('drops the new placeholder when initialize answers retired', async () => {
  const client = createPrimaryWalletCardFundingClient();
  mockFetchJson.mockRejectedValue(retired());
  await expect(client.start(start)).rejects.toMatchObject({
    code: 'PRIMARY_CARD_FUNDING_RETIRED',
  });
  expect(mockStorage.size).toBe(0);
  expect(await client.readPending(scope)).toBeNull();
});

it('releases a saved placeholder whose replayed initialize answers retired', async () => {
  const client = createPrimaryWalletCardFundingClient();
  // An earlier initialize timed out, so the placeholder never learned its
  // operation ID; recovery replays initialize without the capability probe.
  mockFetchJson.mockRejectedValueOnce(new Error('network timeout'));
  await expect(client.start(start)).rejects.toThrow('network timeout');
  expect(mockStorage.size).toBe(1);

  mockFetchJson.mockRejectedValue(retired());
  await expect(client.recover(scope)).rejects.toMatchObject({
    code: 'PRIMARY_CARD_FUNDING_RETIRED',
  });
  expect(mockStorage.size).toBe(0);
  // A different amount is no longer blocked as "another operation pending".
  await expect(
    client.start({ ...start, amountKobo: 250000 })
  ).rejects.toMatchObject({ code: 'PRIMARY_CARD_FUNDING_RETIRED' });
});

it('treats retired as authoritative card not-ready without caching a merchant verdict', () => {
  observePiggyvestPrimaryCapability(scope.merchantId, true);
  expect(isPrimaryWalletNotReady(retired())).toBe(true);
  expect(
    rollbackObservedCapabilityOnNotReady(scope.merchantId, retired())
  ).toBe(true);
  // Card-only signal: the wallet and savings rails keep their verdict.
  expect(readObservedPiggyvestPrimaryCapability(scope.merchantId)).toBe(true);
});
