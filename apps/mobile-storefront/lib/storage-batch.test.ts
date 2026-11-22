import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  removeItem: jest.fn(),
  getMany: jest.fn(),
  removeMany: jest.fn(),
  multiGet: jest.fn(),
  multiRemove: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getAsyncStorageEntries,
  getStorageEntriesAcrossBackends,
  removeAsyncStorageItems,
} from './storage-batch';

type StorageEntry = [string, string | null];
type GetItemMock = jest.MockedFunction<(key: string) => Promise<string | null>>;
type RemoveItemMock = jest.MockedFunction<(key: string) => Promise<void>>;
type GetManyMock = jest.MockedFunction<
  (keys: string[]) => Promise<Record<string, string | null>>
>;
type RemoveManyMock = jest.MockedFunction<(keys: string[]) => Promise<void>>;
type MultiGetMock = jest.MockedFunction<
  (keys: string[]) => Promise<readonly StorageEntry[]>
>;
type MultiRemoveMock = jest.MockedFunction<(keys: string[]) => Promise<void>>;

type AsyncStorageMock = {
  getItem: GetItemMock;
  removeItem: RemoveItemMock;
  getMany?: GetManyMock;
  removeMany?: RemoveManyMock;
  multiGet?: MultiGetMock;
  multiRemove?: MultiRemoveMock;
};

const storageMock = AsyncStorage as unknown as AsyncStorageMock;

describe('storage batching helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storageMock.getMany =
      jest.fn<(keys: string[]) => Promise<Record<string, string | null>>>();
    storageMock.removeMany = jest.fn<(keys: string[]) => Promise<void>>();
    storageMock.multiGet =
      jest.fn<(keys: string[]) => Promise<readonly StorageEntry[]>>();
    storageMock.multiRemove = jest.fn<(keys: string[]) => Promise<void>>();
  });

  it('uses getMany (v3 batch API) when available', async () => {
    storageMock.getMany?.mockResolvedValue({
      prefs: null,
      cart: '{"items":1}',
    });

    const result = await getAsyncStorageEntries(['cart', 'prefs']);

    expect(result).toEqual([
      ['cart', '{"items":1}'],
      ['prefs', null],
    ]);
    expect(storageMock.getMany).toHaveBeenCalledWith(['cart', 'prefs']);
    expect(storageMock.getItem).not.toHaveBeenCalled();
  });

  it('preserves requested key order and duplicates for getMany results', async () => {
    storageMock.getMany?.mockResolvedValue({
      prefs: null,
      cart: '{"items":1}',
    });

    const result = await getAsyncStorageEntries(['cart', 'prefs', 'cart']);

    expect(result).toEqual([
      ['cart', '{"items":1}'],
      ['prefs', null],
      ['cart', '{"items":1}'],
    ]);
  });

  it('falls back to multiGet when getMany is unavailable', async () => {
    storageMock.getMany = undefined;
    storageMock.multiGet?.mockResolvedValue([
      ['cart', 'cached-cart'],
      ['prefs', null],
    ]);

    const result = await getAsyncStorageEntries(['cart', 'prefs']);

    expect(result).toEqual([
      ['cart', 'cached-cart'],
      ['prefs', null],
    ]);
    expect(storageMock.multiGet).toHaveBeenCalledWith(['cart', 'prefs']);
  });

  it('uses removeMany (v3 batch API) when available', async () => {
    storageMock.removeMany?.mockResolvedValue(undefined);

    await removeAsyncStorageItems(['cache:a', 'cache:b']);

    expect(storageMock.removeMany).toHaveBeenCalledWith(['cache:a', 'cache:b']);
    expect(storageMock.removeItem).not.toHaveBeenCalled();
  });

  it('falls back to multiRemove when removeMany is unavailable', async () => {
    storageMock.removeMany = undefined;
    storageMock.multiRemove?.mockResolvedValue(undefined);

    await removeAsyncStorageItems(['cache:a', 'cache:b']);

    expect(storageMock.multiRemove).toHaveBeenCalledWith([
      'cache:a',
      'cache:b',
    ]);
  });

  it('falls back to individual getItem calls when no batch read API is available', async () => {
    storageMock.getMany = undefined;
    storageMock.multiGet = undefined;
    storageMock.getItem.mockImplementation(async (key: string) =>
      key === 'cart' ? 'cached-cart' : null
    );

    const result = await getAsyncStorageEntries(['cart', 'prefs']);

    expect(result).toEqual([
      ['cart', 'cached-cart'],
      ['prefs', null],
    ]);
    expect(storageMock.getItem).toHaveBeenNthCalledWith(1, 'cart');
    expect(storageMock.getItem).toHaveBeenNthCalledWith(2, 'prefs');
  });

  it('falls back to individual removeItem calls when no batch remove API is available', async () => {
    storageMock.removeMany = undefined;
    storageMock.multiRemove = undefined;
    storageMock.removeItem.mockResolvedValue(undefined);

    await removeAsyncStorageItems(['cache:a', 'cache:b']);

    expect(storageMock.removeItem).toHaveBeenNthCalledWith(1, 'cache:a');
    expect(storageMock.removeItem).toHaveBeenNthCalledWith(2, 'cache:b');
  });

  it('returns empty array for empty keys', async () => {
    const result = await getAsyncStorageEntries([]);
    expect(result).toEqual([]);
    expect(storageMock.getMany).not.toHaveBeenCalled();
  });

  it('skips removeMany for empty keys', async () => {
    await removeAsyncStorageItems([]);
    expect(storageMock.removeMany).not.toHaveBeenCalled();
  });

  it('propagates getMany errors', async () => {
    storageMock.getMany?.mockRejectedValue(new Error('storage read failed'));

    await expect(getAsyncStorageEntries(['cart'])).rejects.toThrow(
      'storage read failed'
    );
  });

  it('propagates removeMany errors', async () => {
    storageMock.removeMany?.mockRejectedValue(
      new Error('storage write failed')
    );

    await expect(removeAsyncStorageItems(['cache:a'])).rejects.toThrow(
      'storage write failed'
    );
  });

  it('propagates multiGet fallback errors', async () => {
    storageMock.getMany = undefined;
    storageMock.multiGet?.mockRejectedValue(new Error('multi read failed'));

    await expect(getAsyncStorageEntries(['cart'])).rejects.toThrow(
      'multi read failed'
    );
  });

  it('propagates multiRemove fallback errors', async () => {
    storageMock.removeMany = undefined;
    storageMock.multiRemove?.mockRejectedValue(
      new Error('multi remove failed')
    );

    await expect(removeAsyncStorageItems(['cache:a'])).rejects.toThrow(
      'multi remove failed'
    );
  });
});

it('reads scoped AsyncStorage misses and removes only scoped staging keys', async () => {
  const storagePrefix = 'baci-oxygen-staging.v2.test.';
  Reflect.set(globalThis, '__baciOxygenStagingRuntime', {
    profile: { storagePrefix },
  });
  try {
    storageMock.getItem.mockClear().mockResolvedValue('saved fallback');
    storageMock.removeItem.mockClear().mockResolvedValue(undefined);
    const native = {
      getString: jest.fn((key: string) =>
        key === `${storagePrefix}native` ? 'native data' : undefined
      ),
    };
    await expect(
      getStorageEntriesAcrossBackends(['persisted', 'native'], native)
    ).resolves.toEqual([
      ['persisted', 'saved fallback'],
      ['native', 'native data'],
    ]);
    expect(storageMock.getItem.mock.calls).toEqual([
      [`${storagePrefix}persisted`],
    ]);
    await removeAsyncStorageItems(['persisted']);
    expect(storageMock.removeItem.mock.calls).toEqual([
      [`${storagePrefix}persisted`],
    ]);
  } finally {
    Reflect.deleteProperty(globalThis, '__baciOxygenStagingRuntime');
  }
});
