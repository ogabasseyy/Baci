import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  getAllKeys: jest.fn(),
  getMany: jest.fn(),
  removeMany: jest.fn(),
  multiGet: jest.fn(),
  multiRemove: jest.fn(),
}));

jest.mock('./logger', () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getClearableCacheStorageKeys } from '@/components/settings/clear-cache-keys';
import { QUERY_CACHE_STORAGE_KEY } from '@/lib/query-client';
import { getOxygenStagingProfile } from './oxygen-staging-profile';
import { asyncStorage, getStorageEntries, removeStorageItems } from './storage';

jest.mock('./oxygen-staging-profile', () => {
  const getProfile = jest.fn<() => { storagePrefix: string } | null>(
    () => null
  );
  return {
    getOxygenStagingProfile: getProfile,
    oxygenStagingStorageKey: (key: string) => {
      const prefix = getProfile()?.storagePrefix;
      return prefix && !key.startsWith(prefix) ? prefix + key : key;
    },
  };
});

type GetManyMock = jest.MockedFunction<
  (keys: string[]) => Promise<Record<string, string | null>>
>;
type RemoveManyMock = jest.MockedFunction<(keys: string[]) => Promise<void>>;

type AsyncStorageMock = {
  getMany: GetManyMock;
  removeMany: RemoveManyMock;
};

const storageMock = AsyncStorage as unknown as AsyncStorageMock;

describe('storage fallback wrappers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getOxygenStagingProfile).mockReturnValue(null);
  });

  it('reads through AsyncStorage batch helpers when MMKV is unavailable', async () => {
    storageMock.getMany.mockResolvedValue({
      cart: '{"items":1}',
      prefs: null,
    });

    await expect(getStorageEntries(['cart', 'prefs'])).resolves.toEqual([
      ['cart', '{"items":1}'],
      ['prefs', null],
    ]);
  });

  it('removes through AsyncStorage batch helpers when MMKV is unavailable', async () => {
    storageMock.removeMany.mockResolvedValue(undefined);

    await removeStorageItems(['cache:a', 'cache:b']);

    expect(storageMock.removeMany).toHaveBeenCalledWith(['cache:a', 'cache:b']);
  });

  it('hydrates the saved staging cart from its scoped fallback key', async () => {
    const storagePrefix = 'baci-oxygen-staging.v2.test.';
    jest.mocked(getOxygenStagingProfile).mockReturnValue({
      storagePrefix,
    } as NonNullable<ReturnType<typeof getOxygenStagingProfile>>);
    jest
      .mocked(AsyncStorage.getItem)
      .mockImplementation(async (key) =>
        key === `${storagePrefix}cart-storage` ? '{"items":1}' : null
      );

    await jest.isolateModulesAsync(async () => {
      const { initializeStorage, syncStorage } = await import('./storage');
      await initializeStorage(['cart-storage']);
      expect(syncStorage.getItem('cart-storage')).toBe('{"items":1}');
    });
    expect(AsyncStorage.getItem).not.toHaveBeenCalledWith('cart-storage');
  });

  it('enumerates logical staging keys and only deletes scoped cache entries', async () => {
    const storagePrefix = 'baci-oxygen-staging.v2.test.';
    jest.mocked(getOxygenStagingProfile).mockReturnValue({
      storagePrefix,
    } as NonNullable<ReturnType<typeof getOxygenStagingProfile>>);
    jest
      .mocked(AsyncStorage.getAllKeys)
      .mockResolvedValue([
        `${storagePrefix}cart-storage`,
        `${storagePrefix}cache:disposable`,
        `${storagePrefix}${QUERY_CACHE_STORAGE_KEY}`,
        'baci-oxygen-staging.v2.other.cache:disposable',
        'cache:production',
      ]);

    const keys = await asyncStorage.getAllKeys();
    expect(keys).toEqual([
      'cart-storage',
      'cache:disposable',
      QUERY_CACHE_STORAGE_KEY,
    ]);
    await removeStorageItems(getClearableCacheStorageKeys(keys));
    expect(jest.mocked(AsyncStorage.removeItem).mock.calls).toEqual([
      [`${storagePrefix}cache:disposable`],
      [`${storagePrefix}${QUERY_CACHE_STORAGE_KEY}`],
    ]);
  });
});
