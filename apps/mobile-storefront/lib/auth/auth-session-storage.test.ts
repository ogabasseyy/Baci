const mockLoggerWarn = jest.fn();

jest.mock('../logger', () => ({
  createLogger: () => ({
    warn: mockLoggerWarn,
  }),
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

describe('authSessionStorage', () => {
  beforeEach(() => {
    mockSecureStore.deleteItemAsync.mockReset().mockResolvedValue(undefined);
    mockSecureStore.getItemAsync.mockReset().mockResolvedValue(null);
    mockSecureStore.setItemAsync.mockReset().mockResolvedValue(undefined);
    mockLoggerWarn.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores native Supabase sessions in SecureStore', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue('session-json');

    await expect(authSessionStorage.getItem('auth-key')).resolves.toBe(
      'session-json'
    );
    await authSessionStorage.setItem('auth-key', 'next-json');
    await authSessionStorage.removeItem('auth-key');

    expect(mockSecureStore.getItemAsync).toHaveBeenCalledWith('auth-key');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
      'auth-key',
      'next-json'
    );
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('auth-key');
  });

  it('preserves null values from the underlying storage adapter', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null);

    await expect(authSessionStorage.getItem('auth-key')).resolves.toBeNull();

    expect(mockSecureStore.getItemAsync).toHaveBeenCalledWith('auth-key');
  });

  it('fails open on read errors while propagating delete errors', async () => {
    const storageError = new Error('storage unavailable');
    mockSecureStore.getItemAsync.mockRejectedValue(storageError);
    mockSecureStore.deleteItemAsync.mockRejectedValue(storageError);

    await expect(authSessionStorage.getItem('auth-key')).resolves.toBeNull();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Unable to read the Supabase auth session state.',
      storageError
    );
    await expect(authSessionStorage.removeItem('auth-key')).rejects.toBe(
      storageError
    );
  });

  it('rejects when SecureStore cannot persist rotated session credentials', async () => {
    const storageError = new Error('session payload too large');
    mockSecureStore.setItemAsync.mockRejectedValue(storageError);

    await expect(
      authSessionStorage.setItem('auth-key', 'session-json')
    ).rejects.toBe(storageError);

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Unable to persist Supabase auth session in SecureStore.',
      storageError
    );
  });

  it('returns null when a SecureStore read exceeds the shared deadline', async () => {
    jest.useFakeTimers();
    mockSecureStore.getItemAsync.mockImplementation(
      () => new Promise<never>(() => undefined)
    );

    const result = authSessionStorage.getItem('stalled-read-key');
    await jest.advanceTimersByTimeAsync(4_000);

    await expect(result).resolves.toBeNull();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Unable to read the Supabase auth session state.',
      expect.objectContaining({
        message: 'Supabase auth storage read timed out',
      })
    );
  });

  it.each([
    [
      'write',
      () => authSessionStorage.setItem('stalled-write-key', 'session-json'),
    ],
    ['delete', () => authSessionStorage.removeItem('stalled-delete-key')],
  ])('bounds a stalled SecureStore %s operation', async (operation, run) => {
    jest.useFakeTimers();
    mockSecureStore.getItemAsync.mockImplementation(
      () => new Promise<never>(() => undefined)
    );
    mockSecureStore.setItemAsync.mockImplementation(
      () => new Promise<never>(() => undefined)
    );
    mockSecureStore.deleteItemAsync.mockImplementation(
      () => new Promise<never>(() => undefined)
    );
    mockSecureStore.getItemAsync.mockResolvedValue(null);

    const result = run();
    const rejection = expect(result).rejects.toThrow(
      `Supabase auth storage ${operation} timed out`
    );
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(4_000);

    await rejection;
  });

  it('allows a later storage read after a post-checkout read stalls', async () => {
    jest.useFakeTimers();
    mockSecureStore.getItemAsync
      .mockResolvedValueOnce('captured-session-json')
      .mockImplementationOnce(() => new Promise<never>(() => undefined))
      .mockResolvedValueOnce('current-session-json');

    await expect(authSessionStorage.getItem('read-recovery-key')).resolves.toBe(
      'captured-session-json'
    );
    const stalledRead = authSessionStorage.getItem('read-recovery-key');
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(4_000);
    await expect(stalledRead).resolves.toBeNull();

    await expect(authSessionStorage.getItem('read-recovery-key')).resolves.toBe(
      'current-session-json'
    );
  });

  it('restores a replacement session after a timed-out stale write completes', async () => {
    jest.useFakeTimers();
    let completeStaleWrite: (() => void) | undefined;
    mockSecureStore.setItemAsync
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            completeStaleWrite = resolve;
          })
      )
      .mockResolvedValue(undefined);

    const staleWrite = authSessionStorage.setItem(
      'auth-key',
      'previous-account-session'
    );
    const rejection = expect(staleWrite).rejects.toThrow(
      'Supabase auth storage write timed out'
    );
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(4_000);
    await rejection;

    await authSessionStorage.setItem('auth-key', 'replacement-session');
    completeStaleWrite?.();
    await jest.advanceTimersByTimeAsync(0);

    expect(mockSecureStore.setItemAsync).toHaveBeenLastCalledWith(
      'auth-key',
      'replacement-session'
    );
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledTimes(3);
  });

  it('retries a failed correction before reading a stale replaced session', async () => {
    jest.useFakeTimers();
    let completeStaleWrite: (() => void) | undefined;
    mockSecureStore.setItemAsync
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            completeStaleWrite = resolve;
          })
      )
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('correction unavailable'))
      .mockResolvedValueOnce(undefined);
    mockSecureStore.getItemAsync
      .mockResolvedValueOnce(null)
      .mockResolvedValue('replacement-session');

    const staleWrite = authSessionStorage.setItem(
      'retry-auth-key',
      'previous-account-session'
    );
    const rejection = expect(staleWrite).rejects.toThrow(
      'Supabase auth storage write timed out'
    );
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(4_000);
    await rejection;
    await authSessionStorage.setItem('retry-auth-key', 'replacement-session');

    completeStaleWrite?.();
    await jest.advanceTimersByTimeAsync(0);

    await expect(authSessionStorage.getItem('retry-auth-key')).resolves.toBe(
      'replacement-session'
    );
    expect(mockSecureStore.setItemAsync).toHaveBeenLastCalledWith(
      'retry-auth-key',
      'replacement-session'
    );
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledTimes(4);
  });

  it('keeps a failed delete reconciliation unreadable after a stale write completes', async () => {
    jest.useFakeTimers();
    let completeStaleWrite: (() => void) | undefined;
    mockSecureStore.setItemAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          completeStaleWrite = resolve;
        })
    );
    mockSecureStore.deleteItemAsync
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('delete correction unavailable'));

    const staleWrite = authSessionStorage.setItem(
      'delete-auth-key',
      'previous-account-session'
    );
    const rejection = expect(staleWrite).rejects.toThrow(
      'Supabase auth storage write timed out'
    );
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(4_000);
    await rejection;
    await authSessionStorage.removeItem('delete-auth-key');

    completeStaleWrite?.();
    await jest.advanceTimersByTimeAsync(0);

    const storageReadsBeforeTombstoneCheck =
      mockSecureStore.getItemAsync.mock.calls.length;
    await expect(
      authSessionStorage.getItem('delete-auth-key')
    ).resolves.toBeNull();
    expect(mockSecureStore.getItemAsync).toHaveBeenCalledTimes(
      storageReadsBeforeTombstoneCheck
    );
  });
});
