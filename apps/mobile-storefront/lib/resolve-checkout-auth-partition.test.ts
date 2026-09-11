import { resolveCheckoutAuthPartition } from './resolve-checkout-auth-partition';

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

describe('bugfix: checkout retry identity keeps the originating auth partition', () => {
  it('keeps the originating guest partition after a later sign-in', async () => {
    await expect(
      resolveCheckoutAuthPartition(generation, undefined)
    ).resolves.toBe('guest');
    await expect(
      resolveCheckoutAuthPartition(generation, guestThenUser)
    ).resolves.toBe('guest');
  });
});
