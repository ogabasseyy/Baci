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

describe('auth session storage rollback', () => {
  beforeEach(() => {
    mockSecureStore.deleteItemAsync.mockReset().mockResolvedValue(undefined);
    mockSecureStore.getItemAsync.mockReset().mockResolvedValue(null);
    mockSecureStore.setItemAsync.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('restores the prior session when a timed-out current write later completes', async () => {
    jest.useFakeTimers();
    let storedValue: string | null = 'previous-session';
    let completeTimedOutWrite: (() => void) | undefined;
    mockSecureStore.getItemAsync.mockImplementation(async () => storedValue);
    mockSecureStore.setItemAsync
      .mockImplementationOnce(
        (_key, value) =>
          new Promise<void>((resolve) => {
            completeTimedOutWrite = () => {
              storedValue = value;
              resolve();
            };
          })
      )
      .mockImplementation(async (_key, value) => {
        storedValue = value;
      });

    const timedOutWrite = authSessionStorage.setItem(
      'abandoned-auth-key',
      'unreported-session'
    );
    const rejection = expect(timedOutWrite).rejects.toThrow(
      'Supabase auth storage write timed out'
    );
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(4_000);
    await rejection;

    completeTimedOutWrite?.();
    await jest.advanceTimersByTimeAsync(0);

    await expect(
      authSessionStorage.getItem('abandoned-auth-key')
    ).resolves.toBe('previous-session');
    expect(storedValue).toBe('previous-session');
  });

  it('rolls back a failed interleaved write to the preceding session', async () => {
    let storedValue: string | null = null;
    let completeFirstWrite: (() => void) | undefined;
    let markFirstWriteStarted: (() => void) | undefined;
    const firstWriteStarted = new Promise<void>((resolve) => {
      markFirstWriteStarted = resolve;
    });
    mockSecureStore.getItemAsync.mockImplementation(async () => storedValue);
    mockSecureStore.setItemAsync
      .mockImplementationOnce(
        (_key, value) =>
          new Promise<void>((resolve) => {
            markFirstWriteStarted?.();
            completeFirstWrite = () => {
              storedValue = value;
              resolve();
            };
          })
      )
      .mockRejectedValueOnce(new Error('later write failed'));

    const firstWrite = authSessionStorage.setItem(
      'interleaved-auth-key',
      'first-session'
    );
    const failedLaterWrite = authSessionStorage.setItem(
      'interleaved-auth-key',
      'failed-later-session'
    );
    await firstWriteStarted;
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledTimes(1);

    completeFirstWrite?.();
    await firstWrite;
    await expect(failedLaterWrite).rejects.toThrow('later write failed');

    await expect(
      authSessionStorage.getItem('interleaved-auth-key')
    ).resolves.toBe('first-session');
    expect(storedValue).toBe('first-session');
  });

  it('uses the logical delete as rollback state instead of transient stale storage', async () => {
    jest.useFakeTimers();
    let storedValue: string | null = null;
    let completeTimedOutWrite: (() => void) | undefined;
    const completeDeleteRepairs: Array<() => void> = [];
    mockSecureStore.getItemAsync.mockImplementation(async () => storedValue);
    mockSecureStore.setItemAsync
      .mockImplementationOnce(
        (_key, value) =>
          new Promise<void>((resolve) => {
            completeTimedOutWrite = () => {
              storedValue = value;
              resolve();
            };
          })
      )
      .mockRejectedValueOnce(new Error('replacement write failed'));
    mockSecureStore.deleteItemAsync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          completeDeleteRepairs.push(() => {
            storedValue = null;
            resolve();
          });
        })
    );

    const staleWrite = authSessionStorage.setItem(
      'logical-baseline-key',
      'signed-out-session'
    );
    const timeout = expect(staleWrite).rejects.toThrow(
      'Supabase auth storage write timed out'
    );
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(4_000);
    await timeout;
    completeTimedOutWrite?.();
    await jest.advanceTimersByTimeAsync(0);
    expect(storedValue).toBe('signed-out-session');

    await expect(
      authSessionStorage.setItem('logical-baseline-key', 'replacement-session')
    ).rejects.toThrow('replacement write failed');
    for (const completeDeleteRepair of completeDeleteRepairs) {
      completeDeleteRepair();
    }
    await jest.advanceTimersByTimeAsync(0);

    await expect(
      authSessionStorage.getItem('logical-baseline-key')
    ).resolves.toBeNull();
    expect(storedValue).toBeNull();
  });

  it('preserves pending rollback reconciliation after a later write fails', async () => {
    jest.useFakeTimers();
    let storedValue: string | null = null;
    let completeTimedOutWrite: (() => void) | undefined;
    const deleteRepairs: Array<{
      reject: (error: Error) => void;
      resolve: () => void;
    }> = [];
    mockSecureStore.getItemAsync.mockImplementation(async () => storedValue);
    mockSecureStore.setItemAsync
      .mockImplementationOnce(
        (_key, value) =>
          new Promise<void>((resolve) => {
            completeTimedOutWrite = () => {
              storedValue = value;
              resolve();
            };
          })
      )
      .mockRejectedValueOnce(new Error('replacement write failed'));
    mockSecureStore.deleteItemAsync.mockImplementation(
      () =>
        new Promise<void>((resolve, reject) => {
          deleteRepairs.push({
            reject,
            resolve: () => {
              storedValue = null;
              resolve();
            },
          });
        })
    );

    const staleWrite = authSessionStorage.setItem(
      'pending-rollback-key',
      'stale-session'
    );
    const timeout = expect(staleWrite).rejects.toThrow(
      'Supabase auth storage write timed out'
    );
    await jest.advanceTimersByTimeAsync(4_000);
    await timeout;
    deleteRepairs[0]?.reject(new Error('first correction failed'));
    await jest.advanceTimersByTimeAsync(0);

    completeTimedOutWrite?.();
    await jest.advanceTimersByTimeAsync(0);
    deleteRepairs[1]?.reject(new Error('late correction failed'));
    await jest.advanceTimersByTimeAsync(0);
    expect(storedValue).toBe('stale-session');

    await expect(
      authSessionStorage.setItem('pending-rollback-key', 'replacement-session')
    ).rejects.toThrow('replacement write failed');
    expect(deleteRepairs).toHaveLength(3);
    deleteRepairs[2]?.resolve();
    await jest.advanceTimersByTimeAsync(0);

    await expect(
      authSessionStorage.getItem('pending-rollback-key')
    ).resolves.toBeNull();
    expect(storedValue).toBeNull();
  });

  it('does not duplicate a primary write when storage is read concurrently', async () => {
    const storedValue: string | null = 'previous-session';
    let rejectPrimaryWrite: ((error: Error) => void) | undefined;
    mockSecureStore.getItemAsync.mockImplementation(async () => storedValue);
    mockSecureStore.setItemAsync.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPrimaryWrite = reject;
        })
    );

    const primaryWrite = authSessionStorage.setItem(
      'concurrent-read-key',
      'unreported-session'
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const concurrentRead = authSessionStorage.getItem('concurrent-read-key');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(mockSecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    rejectPrimaryWrite?.(new Error('primary write failed'));
    await expect(primaryWrite).rejects.toThrow('primary write failed');
    await expect(concurrentRead).resolves.toBeNull();
    await expect(
      authSessionStorage.getItem('concurrent-read-key')
    ).resolves.toBe('previous-session');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  });

  it('does not mutate storage when the rollback baseline is unknown', async () => {
    const snapshotError = new Error('rollback snapshot unavailable');
    mockSecureStore.getItemAsync.mockRejectedValue(snapshotError);

    await expect(
      authSessionStorage.setItem('unknown-baseline-key', 'new-session')
    ).rejects.toBe(snapshotError);
    await expect(
      authSessionStorage.removeItem('unknown-delete-baseline-key')
    ).rejects.toBe(snapshotError);

    expect(mockSecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(mockSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });
});
