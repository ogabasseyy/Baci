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

  it('rotates the partition when a different authenticated account takes over the cart', async () => {
    const accountA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const accountB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await expect(
      resolveCheckoutAuthPartition(generation, accountA)
    ).resolves.toBe(accountA);
    await expect(
      resolveCheckoutAuthPartition(generation, accountB)
    ).resolves.toBe(accountB);
  });

  it('rotates the partition when the authenticated session is lost', async () => {
    const accountA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await expect(
      resolveCheckoutAuthPartition(generation, accountA)
    ).resolves.toBe(accountA);
    await expect(
      resolveCheckoutAuthPartition(generation, undefined)
    ).resolves.toBe('guest');
  });

  it('keeps the live generation partition when a queued generation replays', async () => {
    const liveGeneration = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const queuedGeneration = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await expect(
      resolveCheckoutAuthPartition(liveGeneration, undefined)
    ).resolves.toBe('guest');
    await expect(
      resolveCheckoutAuthPartition(queuedGeneration, guestThenUser)
    ).resolves.toBe(guestThenUser);
    await expect(
      resolveCheckoutAuthPartition(liveGeneration, guestThenUser)
    ).resolves.toBe('guest');
  });

  it('keeps the stored partition when the session read is inconclusive', async () => {
    const accountA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await expect(
      resolveCheckoutAuthPartition(generation, accountA)
    ).resolves.toBe(accountA);
    await expect(
      resolveCheckoutAuthPartition(generation, undefined, {
        sessionReadInconclusive: true,
      })
    ).resolves.toBe(accountA);
  });

  it('preserves both generations when live and queued resolves overlap', async () => {
    const liveGeneration = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const queuedGeneration = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await Promise.all([
      resolveCheckoutAuthPartition(liveGeneration, undefined),
      resolveCheckoutAuthPartition(queuedGeneration, guestThenUser),
    ]);
    await expect(
      resolveCheckoutAuthPartition(liveGeneration, guestThenUser)
    ).resolves.toBe('guest');
    await expect(
      resolveCheckoutAuthPartition(queuedGeneration, guestThenUser)
    ).resolves.toBe(guestThenUser);
  });
});
