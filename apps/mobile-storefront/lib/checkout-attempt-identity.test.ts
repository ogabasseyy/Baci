import {
  persistCheckoutGeneration,
  resolveCheckoutAuthPartition,
} from './checkout-attempt-identity';

const storage = new Map<string, string>();
const mockGetItem = jest.fn(async (key: string) => storage.get(key) ?? null);
const mockSetItem = jest.fn(async (key: string, value: string) => {
  storage.set(key, value);
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
}));

const generation = '46ed63d7-5f10-49f0-9456-9ff571bec43f';
const guestThenUser = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

beforeEach(() => {
  storage.clear();
  mockGetItem.mockClear();
  mockSetItem.mockClear();
});

describe('bugfix: checkout retry identity is durable before the order request', () => {
  it('does not return until the generation write succeeds', async () => {
    mockSetItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(persistCheckoutGeneration(generation)).rejects.toThrow(
      'disk full'
    );
    await persistCheckoutGeneration(generation);
    expect(storage.get('checkout-generation-v1')).toBe(generation);
  });

  it('keeps the originating guest partition after a later sign-in', async () => {
    await expect(
      resolveCheckoutAuthPartition(generation, undefined)
    ).resolves.toBe('guest');
    await expect(
      resolveCheckoutAuthPartition(generation, guestThenUser)
    ).resolves.toBe('guest');
  });
});
