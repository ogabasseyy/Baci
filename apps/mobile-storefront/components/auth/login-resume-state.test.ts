import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import * as storefrontStoragePrefix from '@/lib/storefront-storage-prefix';
import {
  clearAuthLoginResumeState,
  getAuthLoginResumeState,
  getPendingAuthLoginResumeState,
  saveAuthLoginResumeState,
} from './login-resume-state';

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    warn: jest.fn(),
  }),
}));

const mockDeleteItemAsync = SecureStore.deleteItemAsync as jest.MockedFunction<
  typeof SecureStore.deleteItemAsync
>;
const mockGetItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
  typeof SecureStore.getItemAsync
>;
const mockSetItemAsync = SecureStore.setItemAsync as jest.MockedFunction<
  typeof SecureStore.setItemAsync
>;
const originalPlatformOS = Platform.OS;

function setPlatformOS(value: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value,
  });
}

function mockWebSessionStorage(overrides: Partial<Storage> = {}) {
  const sessionStorage = {
    getItem: jest.fn(() => null),
    removeItem: jest.fn(),
    setItem: jest.fn(),
    ...overrides,
  } as unknown as Storage;

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { sessionStorage },
  });

  return sessionStorage;
}

describe('login resume state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mockDeleteItemAsync.mockResolvedValue(undefined);
    mockGetItemAsync.mockResolvedValue(null);
    mockSetItemAsync.mockResolvedValue(undefined);
    setPlatformOS(originalPlatformOS);
  });

  afterEach(() => {
    setPlatformOS(originalPlatformOS);
    jest.restoreAllMocks();
  });

  it('stores pending OTP login state with a timestamp', async () => {
    await saveAuthLoginResumeState({
      email: 'shopper@example.com',
      returnTo: '/checkout',
      step: 'otp',
    });

    expect(mockSetItemAsync).toHaveBeenCalledTimes(1);
    const [, serializedState] = mockSetItemAsync.mock.calls[0];
    expect(JSON.parse(serializedState)).toEqual({
      email: 'shopper@example.com',
      returnTo: '/checkout',
      savedAt: 1_000_000,
      step: 'otp',
    });
  });

  it('returns pending OTP state only for the expected safe return target', async () => {
    mockGetItemAsync.mockResolvedValueOnce(
      JSON.stringify({
        email: 'shopper@example.com',
        returnTo: '/checkout',
        savedAt: 1_000_000,
        step: 'otp',
      })
    );

    await expect(getAuthLoginResumeState('/checkout')).resolves.toEqual({
      email: 'shopper@example.com',
      returnTo: '/checkout',
      step: 'otp',
    });

    mockGetItemAsync.mockResolvedValueOnce(
      JSON.stringify({
        email: 'shopper@example.com',
        returnTo: '/checkout',
        savedAt: 1_000_000,
        step: 'otp',
      })
    );

    await expect(getAuthLoginResumeState('/cart')).resolves.toBeNull();

    mockGetItemAsync.mockResolvedValueOnce(
      JSON.stringify({
        email: 'shopper@example.com',
        returnTo: 'https://evil.example/checkout',
        savedAt: 1_000_000,
        step: 'otp',
      })
    );

    await expect(
      getAuthLoginResumeState('https://evil.example/checkout')
    ).resolves.toBeNull();
  });

  it('returns pending OTP state with a safe return target for account verify redirects', async () => {
    mockGetItemAsync.mockResolvedValueOnce(
      JSON.stringify({
        email: 'shopper@example.com',
        returnTo: '/checkout',
        savedAt: 1_000_000,
        step: 'otp',
      })
    );

    await expect(getPendingAuthLoginResumeState()).resolves.toEqual({
      email: 'shopper@example.com',
      returnTo: '/checkout',
      step: 'otp',
    });
  });

  it('rejects pending OTP state with an unsafe return target for account verify redirects', async () => {
    mockGetItemAsync.mockResolvedValueOnce(
      JSON.stringify({
        email: 'shopper@example.com',
        returnTo: 'https://evil.example/checkout',
        savedAt: 1_000_000,
        step: 'otp',
      })
    );

    await expect(getPendingAuthLoginResumeState()).resolves.toBeNull();
  });

  it('ignores malformed or stale pending OTP state', async () => {
    mockGetItemAsync.mockResolvedValueOnce('not json');
    await expect(getAuthLoginResumeState('/checkout')).resolves.toBeNull();

    mockGetItemAsync.mockResolvedValueOnce(
      JSON.stringify({
        email: 'shopper@example.com',
        returnTo: '/checkout',
        savedAt: 1,
        step: 'otp',
      })
    );
    await expect(getAuthLoginResumeState('/checkout')).resolves.toBeNull();

    mockGetItemAsync.mockResolvedValueOnce(
      JSON.stringify({
        email: 'shopper@example.com',
        returnTo: '/checkout',
        savedAt: 1_000_001,
        step: 'otp',
      })
    );
    await expect(getAuthLoginResumeState('/checkout')).resolves.toBeNull();

    mockGetItemAsync.mockResolvedValueOnce(
      JSON.stringify({
        email: 'shopper@example.com',
        returnTo: '/checkout',
        savedAt: 1_000_001,
        step: 'otp',
      })
    );
    await expect(getPendingAuthLoginResumeState()).resolves.toBeNull();

    mockGetItemAsync.mockResolvedValueOnce(
      JSON.stringify({
        email: 'not-an-email',
        returnTo: '/checkout',
        savedAt: 1_000_000,
        step: 'otp',
      })
    );
    await expect(getAuthLoginResumeState('/checkout')).resolves.toBeNull();
  });

  it('uses sessionStorage for web pending OTP login state', async () => {
    setPlatformOS('web');
    const sessionStorage = mockWebSessionStorage();

    await saveAuthLoginResumeState({
      email: 'shopper@example.com',
      returnTo: '/checkout',
      step: 'otp',
    });

    expect(sessionStorage.setItem).toHaveBeenCalledTimes(1);
    expect(mockSetItemAsync).not.toHaveBeenCalled();

    const [, serializedState] = (sessionStorage.setItem as jest.Mock).mock
      .calls[0];
    (sessionStorage.getItem as jest.Mock).mockReturnValueOnce(serializedState);

    await expect(getAuthLoginResumeState('/checkout')).resolves.toEqual({
      email: 'shopper@example.com',
      returnTo: '/checkout',
      step: 'otp',
    });

    await clearAuthLoginResumeState();

    expect(sessionStorage.removeItem).toHaveBeenCalledTimes(1);
    expect(mockDeleteItemAsync).not.toHaveBeenCalled();
  });

  it('handles web sessionStorage errors without falling back to native storage', async () => {
    setPlatformOS('web');
    const sessionStorage = mockWebSessionStorage({
      getItem: jest.fn(() => {
        throw new Error('read failed');
      }),
      removeItem: jest.fn(() => {
        throw new Error('remove failed');
      }),
      setItem: jest.fn(() => {
        throw new Error('write failed');
      }),
    });

    await expect(
      saveAuthLoginResumeState({
        email: 'shopper@example.com',
        returnTo: '/checkout',
        step: 'otp',
      })
    ).resolves.toBeUndefined();
    await expect(getAuthLoginResumeState('/checkout')).resolves.toBeNull();
    await expect(clearAuthLoginResumeState()).resolves.toBeUndefined();

    expect(sessionStorage.setItem).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem).toHaveBeenCalledTimes(1);
    expect(sessionStorage.removeItem).toHaveBeenCalledTimes(1);
    expect(mockSetItemAsync).not.toHaveBeenCalled();
    expect(mockGetItemAsync).not.toHaveBeenCalled();
    expect(mockDeleteItemAsync).not.toHaveBeenCalled();
  });

  it('clears pending OTP login state', async () => {
    await clearAuthLoginResumeState();

    expect(mockDeleteItemAsync).toHaveBeenCalledTimes(1);
  });

  it('imports without throwing when storage prefix resolution is misconfigured', () => {
    const previousMode = process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = 'bogus';
    try {
      let moduleExports: typeof import('./login-resume-state') | null = null;
      jest.isolateModules(() => {
        moduleExports = jest.requireActual(
          './login-resume-state'
        ) as typeof import('./login-resume-state');
      });

      expect(moduleExports).not.toBeNull();
    } finally {
      if (previousMode === undefined) {
        delete process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
      } else {
        process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = previousMode;
      }
    }
  });

  it('reads pre-migration resume state from the legacy unprefixed key', async () => {
    jest
      .spyOn(storefrontStoragePrefix, 'getStorefrontStoragePrefix')
      .mockReturnValue('baci-test.');
    mockGetItemAsync.mockResolvedValueOnce(null);
    mockGetItemAsync.mockResolvedValueOnce(
      JSON.stringify({
        email: 'shopper@example.com',
        returnTo: '/checkout',
        savedAt: 1_000_000,
        step: 'otp',
      })
    );

    await expect(getAuthLoginResumeState('/checkout')).resolves.toEqual({
      email: 'shopper@example.com',
      returnTo: '/checkout',
      step: 'otp',
    });
    expect(mockGetItemAsync.mock.calls.map(([key]) => key)).toEqual([
      'baci-test.auth-login-resume-state',
      'auth-login-resume-state',
    ]);
  });

  it('uses the legacy key when storage prefix resolution throws', async () => {
    jest
      .spyOn(storefrontStoragePrefix, 'getStorefrontStoragePrefix')
      .mockImplementation(() => {
        throw new Error('Invalid hosted storage mode');
      });

    await saveAuthLoginResumeState({
      email: 'shopper@example.com',
      returnTo: '/checkout',
      step: 'otp',
    });

    expect(mockSetItemAsync).toHaveBeenCalledTimes(1);
    expect(mockSetItemAsync.mock.calls[0][0]).toBe(
      'auth-login-resume-state'
    );

    mockGetItemAsync.mockResolvedValueOnce(
      JSON.stringify({
        email: 'shopper@example.com',
        returnTo: '/checkout',
        savedAt: 1_000_000,
        step: 'otp',
      })
    );

    await expect(getPendingAuthLoginResumeState()).resolves.toEqual({
      email: 'shopper@example.com',
      returnTo: '/checkout',
      step: 'otp',
    });
  });

  it('clears both the prefixed and legacy resume keys', async () => {
    jest
      .spyOn(storefrontStoragePrefix, 'getStorefrontStoragePrefix')
      .mockReturnValue('baci-test.');

    await clearAuthLoginResumeState();

    expect(mockDeleteItemAsync.mock.calls.map(([key]) => key)).toEqual([
      'baci-test.auth-login-resume-state',
      'auth-login-resume-state',
    ]);
  });
});
