const mockLoggerWarn = jest.fn();

jest.mock('../logger', () => ({
  createLogger: () => ({ warn: mockLoggerWarn }),
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

describe('checkout auth session rotation storage', () => {
  beforeEach(() => {
    mockSecureStore.deleteItemAsync.mockReset().mockResolvedValue(undefined);
    mockSecureStore.getItemAsync.mockReset().mockResolvedValue(null);
    mockSecureStore.setItemAsync.mockReset().mockResolvedValue(undefined);
    mockLoggerWarn.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('preserves rotated credentials when their SecureStore write exceeds the checkout deadline', async () => {
    jest.useFakeTimers();
    let completeWrite: (() => void) | undefined;
    mockSecureStore.setItemAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          completeWrite = resolve;
        })
    );

    const write = authSessionStorage.setItem(
      'rotated-auth-key',
      'rotated-session-json',
      Date.now() + 100
    );
    const rejection = expect(write).rejects.toThrow(
      'Supabase auth storage write timed out'
    );
    await jest.advanceTimersByTimeAsync(100);
    await rejection;

    completeWrite?.();
    await jest.advanceTimersByTimeAsync(0);
    mockSecureStore.getItemAsync.mockResolvedValue('rotated-session-json');

    await expect(authSessionStorage.getItem('rotated-auth-key')).resolves.toBe(
      'rotated-session-json'
    );
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  });

  it('reconciles rotated credentials when their timed-out SecureStore write later rejects', async () => {
    jest.useFakeTimers();
    let rejectWrite: ((error: Error) => void) | undefined;
    mockSecureStore.setItemAsync
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectWrite = reject;
          })
      )
      .mockResolvedValueOnce(undefined);

    const write = authSessionStorage.setItem(
      'rejected-rotation-key',
      'rotated-session-json',
      Date.now() + 100
    );
    const timeout = expect(write).rejects.toThrow(
      'Supabase auth storage write timed out'
    );
    await jest.advanceTimersByTimeAsync(100);
    await timeout;

    rejectWrite?.(new Error('late SecureStore failure'));
    await jest.advanceTimersByTimeAsync(0);
    mockSecureStore.getItemAsync.mockResolvedValue('rotated-session-json');

    await expect(
      authSessionStorage.getItem('rejected-rotation-key')
    ).resolves.toBe('rotated-session-json');
    expect(mockSecureStore.setItemAsync).toHaveBeenLastCalledWith(
      'rejected-rotation-key',
      'rotated-session-json'
    );
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledTimes(2);
  });

  it('does not loop when the corrective rotated-credential write also rejects', async () => {
    jest.useFakeTimers();
    let rejectWrite: ((error: Error) => void) | undefined;
    mockSecureStore.setItemAsync
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectWrite = reject;
          })
      )
      .mockRejectedValueOnce(new Error('corrective write unavailable'));

    const write = authSessionStorage.setItem(
      'failed-correction-key',
      'rotated-session-json',
      Date.now() + 100
    );
    const timeout = expect(write).rejects.toThrow(
      'Supabase auth storage write timed out'
    );
    await jest.advanceTimersByTimeAsync(100);
    await timeout;

    rejectWrite?.(new Error('late SecureStore failure'));
    await jest.advanceTimersByTimeAsync(0);

    expect(mockSecureStore.setItemAsync).toHaveBeenCalledTimes(2);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Unable to reconcile the latest Supabase auth session state.',
      expect.any(Error)
    );
  });
});
