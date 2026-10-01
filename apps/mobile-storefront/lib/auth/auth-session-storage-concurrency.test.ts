jest.mock('../logger', () => ({
  createLogger: () => ({ warn: jest.fn() }),
}));

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const { authSessionStorage } = jest.requireActual<
  typeof import('./auth-session-storage')
>('./auth-session-storage');
const mockSecureStore = jest.requireMock<typeof import('expo-secure-store')>(
  'expo-secure-store'
) as jest.Mocked<typeof import('expo-secure-store')>;

describe('authSessionStorage concurrent reads', () => {
  beforeEach(() => {
    mockSecureStore.deleteItemAsync.mockReset().mockResolvedValue(undefined);
    mockSecureStore.getItemAsync.mockReset().mockResolvedValue(null);
    mockSecureStore.setItemAsync.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not apply one checkout deadline to an overlapping storage read', async () => {
    jest.useFakeTimers();
    mockSecureStore.getItemAsync.mockImplementation(
      (key) =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve(`${key}-session`),
            key === 'first-checkout' ? 200 : 150
          );
        })
    );

    const first = authSessionStorage.getItem(
      'first-checkout',
      Date.now() + 100
    );
    const second = authSessionStorage.getItem('second-checkout');
    await jest.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toBeNull();
    await jest.advanceTimersByTimeAsync(50);

    await expect(second).resolves.toBe('second-checkout-session');
  });

  it('retries a read when a newer session revision commits during storage access', async () => {
    let resolveInitialRead: ((value: string | null) => void) | undefined;
    mockSecureStore.getItemAsync
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInitialRead = resolve;
          })
      )
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('new-session');

    const read = authSessionStorage.getItem('revision-key');
    await authSessionStorage.setItem('revision-key', 'new-session');
    resolveInitialRead?.('old-session');

    await expect(read).resolves.toBe('new-session');
    expect(mockSecureStore.getItemAsync).toHaveBeenCalledTimes(3);
  });
});
