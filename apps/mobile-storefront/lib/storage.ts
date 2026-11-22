/**
 * Storage utility for Zustand persistence
 * Uses MMKV for high-performance synchronous native storage when available,
 * with a seamless backward-compatible fallback to AsyncStorage for Web/SSR and Expo Go.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import { createLogger } from './logger';
import {
  getOxygenStagingProfile,
  oxygenStagingStorageKey,
} from './oxygen-staging-profile';
import {
  getAsyncStorageEntries,
  getStorageEntriesAcrossBackends,
  removeAsyncStorageItems,
} from './storage-batch';

const log = createLogger('Storage');
const installedProfile = getOxygenStagingProfile();
if (process.env.EXPO_PUBLIC_OXYGEN_STAGING === '1' && !installedProfile)
  throw new Error('Install the Oxygen staging profile before opening storage');

// Safe instantiation of high-performance MMKV storage (native only, guarded against Web/SSR/Go failures)
let mmkvStorage: ReturnType<typeof createMMKV> | null = null;
try {
  if (Platform.OS !== 'web' && process.env.NODE_ENV !== 'test') {
    mmkvStorage = createMMKV({
      id: installedProfile?.storagePrefix ?? 'baci-storefront-storage',
    });
  }
} catch (error) {
  log.warn(
    'Failed to initialize MMKV, falling back to AsyncStorage/memory:',
    error
  );
}

export function getStorageEntries(
  keys: readonly string[]
): Promise<[string, string | null][]> {
  return getStorageEntriesAcrossBackends(keys, mmkvStorage);
}

export async function removeStorageItems(
  keys: readonly string[]
): Promise<void> {
  if (keys.length === 0) return;

  if (mmkvStorage) {
    for (const key of keys) {
      mmkvStorage.remove(oxygenStagingStorageKey(key));
    }
    await removeAsyncStorageItems(keys);
    return;
  }

  await removeAsyncStorageItems(keys);
}

/**
 * MMKV-backed storage adapter for Zustand persist middleware
 * Fully fallback-safe for Expo Go / Web SSR contexts
 */
export const asyncStorage = {
  getItem: async (inputName: string): Promise<string | null> => {
    const name = oxygenStagingStorageKey(inputName);
    try {
      if (mmkvStorage) {
        const value = mmkvStorage.getString(name) ?? null;
        if (value !== null) {
          return value;
        }

        const legacyValue = await AsyncStorage.getItem(name);
        if (legacyValue !== null) {
          mmkvStorage.set(name, legacyValue);
          await AsyncStorage.removeItem(name);
        }
        return legacyValue;
      }
      return await AsyncStorage.getItem(name);
    } catch (error) {
      log.warn('Failed to get item:', name, error);
      return null;
    }
  },
  setItem: async (inputName: string, value: string): Promise<void> => {
    const name = oxygenStagingStorageKey(inputName);
    try {
      if (mmkvStorage) {
        mmkvStorage.set(name, value);
        return;
      }
      await AsyncStorage.setItem(name, value);
    } catch (error) {
      log.warn('Failed to set item:', name, error);
    }
  },
  removeItem: async (inputName: string): Promise<void> => {
    const name = oxygenStagingStorageKey(inputName);
    try {
      if (mmkvStorage) {
        mmkvStorage.remove(name);
      }
      await AsyncStorage.removeItem(name);
    } catch (error) {
      log.warn('Failed to remove item:', name, error);
    }
  },
  // Union of MMKV + legacy AsyncStorage keys: migrated data lives in MMKV, but
  // some keys (e.g. the React Query cache, which intentionally stays on
  // AsyncStorage) are only in AsyncStorage — both must be visible to callers
  // that enumerate keys. Storage backends are isolated so a legacy SQLite
  // failure does not hide valid MMKV keys.
  getAllKeys: async (): Promise<string[]> => {
    const keys: string[] = [];

    if (mmkvStorage) {
      try {
        keys.push(...mmkvStorage.getAllKeys());
      } catch (error) {
        log.warn('Failed to get MMKV keys:', error);
      }
    }

    try {
      keys.push(...(await AsyncStorage.getAllKeys()));
    } catch (error) {
      log.warn('Failed to get legacy AsyncStorage keys:', error);
    }

    const prefix = getOxygenStagingProfile()?.storagePrefix;
    return Array.from(
      new Set(
        prefix
          ? keys
              .filter((key) => key.startsWith(prefix))
              .map((key) => key.slice(prefix.length))
          : keys
      )
    );
  },
};

/**
 * Sync storage adapter (for compatibility with existing code)
 * Backed by native MMKV, falls back to in-memory cache with AsyncStorage persistence
 */
const memoryCache: Record<string, string> = {};
let isStorageInitialized = false;
let initializationPromise: Promise<void> | null = null;
export const DEFAULT_SYNC_STORAGE_KEYS = [
  'cart-storage',
  'saved-storage',
  'comparison-storage',
  'search_history',
] as const;

function isServerWebRender(): boolean {
  return Platform.OS === 'web' && typeof window === 'undefined';
}

export const syncStorage = {
  getItem: (inputName: string): string | null => {
    const name = oxygenStagingStorageKey(inputName);
    if (mmkvStorage) {
      return mmkvStorage.getString(name) ?? null;
    }

    if (
      !isStorageInitialized &&
      !initializationPromise &&
      !isServerWebRender()
    ) {
      log.warn(
        `Storage accessed ("${name}") before initialization complete. ` +
          'Ensure initializeStorage() is called and awaited in _layout.tsx before Zustand stores are accessed.'
      );
    }
    return memoryCache[name] ?? null;
  },
  setItem: (inputName: string, value: string): void => {
    const name = oxygenStagingStorageKey(inputName);
    if (mmkvStorage) {
      mmkvStorage.set(name, value);
      return;
    }

    memoryCache[name] = value;
    AsyncStorage.setItem(name, value).catch((error) =>
      log.warn('Failed to persist item:', name, error)
    );
  },
  removeItem: (inputName: string): void => {
    const name = oxygenStagingStorageKey(inputName);
    if (mmkvStorage) {
      mmkvStorage.remove(name);
      AsyncStorage.removeItem(name).catch((error) =>
        log.warn('Failed to remove legacy item:', name, error)
      );
      return;
    }

    delete memoryCache[name];
    AsyncStorage.removeItem(name).catch((error) =>
      log.warn('Failed to remove item:', name, error)
    );
  },
};

/**
 * Check if storage has been initialized
 */
export function isStorageReady(): boolean {
  return isStorageInitialized;
}

/**
 * Wait for storage initialization to complete
 */
export async function waitForStorageReady(): Promise<void> {
  if (isStorageInitialized) return;
  if (initializationPromise) {
    await initializationPromise;
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (initializationPromise) {
    await initializationPromise;
  }
}

/**
 * Initialize storage by loading persisted data into memory cache
 */
export function initializeStorage(keys: readonly string[]): Promise<void> {
  if (initializationPromise) {
    log.debug('Initialization already in progress, waiting...');
    return initializationPromise;
  }

  if (isStorageInitialized) {
    log.debug('Already initialized, skipping');
    return Promise.resolve();
  }

  initializationPromise = (async () => {
    try {
      log.debug('Initializing with keys:', keys);
      const pairs = await getAsyncStorageEntries(keys);
      const migratedKeys: string[] = [];
      for (const [key, value] of pairs) {
        if (value !== null) {
          if (mmkvStorage) {
            const existingValue =
              mmkvStorage.getString(oxygenStagingStorageKey(key)) ?? null;
            if (existingValue === null) {
              mmkvStorage.set(oxygenStagingStorageKey(key), value);
              log.debug(`Migrated "${key}" from AsyncStorage to MMKV`);
            }
            migratedKeys.push(key);
          } else {
            memoryCache[oxygenStagingStorageKey(key)] = value;
            log.debug(`Loaded "${key}" from AsyncStorage`);
          }
        }
      }
      if (mmkvStorage && migratedKeys.length > 0) {
        await removeAsyncStorageItems(migratedKeys);
        log.debug('Removed migrated legacy AsyncStorage keys');
      }
      isStorageInitialized = true;
      log.debug('Initialization complete');
    } catch (error) {
      log.warn('Failed to initialize:', error);
      isStorageInitialized = true;
    } finally {
      initializationPromise = null;
    }
  })();

  return initializationPromise;
}

if (!isServerWebRender()) {
  void initializeStorage(DEFAULT_SYNC_STORAGE_KEYS);
}
