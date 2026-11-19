import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getOxygenStagingProfile,
  oxygenStagingStorageKey,
} from './oxygen-staging-profile';

/**
 * AsyncStorage v3 batch helpers with compatibility fallback for older builds.
 */
type AsyncStorageBatchExtensions = typeof AsyncStorage & {
  getMany?: (keys: string[]) => Promise<Record<string, string | null>>;
  removeMany?: (keys: string[]) => Promise<void>;
  multiGet?: (keys: string[]) => Promise<readonly StorageEntry[]>;
  multiRemove?: (keys: string[]) => Promise<void>;
};

type StorageEntry = [string, string | null];

const batchStorage = AsyncStorage as AsyncStorageBatchExtensions;

export async function getAsyncStorageEntries(
  keys: readonly string[]
): Promise<[string, string | null][]> {
  if (keys.length === 0) return [];
  if (getOxygenStagingProfile())
    return Promise.all(
      keys.map(
        async (key) =>
          [key, await AsyncStorage.getItem(oxygenStagingStorageKey(key))] as [
            string,
            string | null,
          ]
      )
    );

  if (typeof batchStorage.getMany === 'function') {
    const record = await batchStorage.getMany([...keys]);
    return keys.map((key) => [key, record[key] ?? null]);
  }

  if (typeof batchStorage.multiGet === 'function') {
    const entries = await batchStorage.multiGet([...keys]);
    return entries.map(([key, value]): StorageEntry => [key, value]);
  }

  return Promise.all(
    keys.map(
      async (key): Promise<StorageEntry> => [
        key,
        await AsyncStorage.getItem(key),
      ]
    )
  );
}

export async function getStorageEntriesAcrossBackends(
  keys: readonly string[],
  native: { getString(key: string): string | undefined } | null
): Promise<StorageEntry[]> {
  if (!native) return getAsyncStorageEntries(keys);
  const entries = keys.map(
    (key): StorageEntry => [
      key,
      native.getString(oxygenStagingStorageKey(key)) ?? null,
    ]
  );
  const fallback = new Map(
    await getAsyncStorageEntries(
      entries.filter(([, value]) => value === null).map(([key]) => key)
    )
  );
  return entries.map(([key, value]) => [
    key,
    value ?? fallback.get(key) ?? null,
  ]);
}

export async function removeAsyncStorageItems(
  keys: readonly string[]
): Promise<void> {
  if (keys.length === 0) return;
  if (getOxygenStagingProfile()) {
    await Promise.all(
      keys.map((key) => AsyncStorage.removeItem(oxygenStagingStorageKey(key)))
    );
    return;
  }

  if (typeof batchStorage.removeMany === 'function') {
    await batchStorage.removeMany([...keys]);
    return;
  }

  if (typeof batchStorage.multiRemove === 'function') {
    await batchStorage.multiRemove([...keys]);
    return;
  }

  await Promise.all(keys.map((key) => AsyncStorage.removeItem(key)));
}
