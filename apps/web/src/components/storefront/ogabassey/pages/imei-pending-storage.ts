import {
  IMEI_DEVICE_CATEGORIES,
  IMEI_SERVICE_TIERS,
  type ImeiDeviceCategory,
  type ImeiServiceTierKey,
  isImeiServiceTierKey,
} from '@baci/shared/imei';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface StorageAdapter {
  getItem(key: string): string | null;
  removeItem(key: string): unknown;
  setItem(key: string, value: string): unknown;
}

/** Persistence assists recovery; it must never prevent a paid lookup progressing. */
export function getPendingImeiStorage(): StorageAdapter | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface PendingImeiLookup {
  createdAt: string;
  lookupId: string;
  tier: ImeiServiceTierKey;
  device?: ImeiDeviceCategory;
}

export function pendingImeiStorageKey(
  host: string,
  customerId: string,
  merchantSlug: string
) {
  return `baci:imei-pending:v2:${host.toLowerCase()}:${merchantSlug.toLowerCase()}:${customerId}`;
}

export function savePendingImeiLookup(
  storage: StorageAdapter | null,
  key: string,
  pending: PendingImeiLookup
) {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(pending));
    return true;
  } catch {
    console.warn('Pending IMEI recovery could not be saved.');
    return false;
  }
}

export function clearPendingImeiLookup(
  storage: StorageAdapter | null,
  key: string
) {
  try {
    storage?.removeItem(key);
  } catch {
    // In-memory completion and reset still work if recovery data cannot clear.
  }
}

export function loadPendingImeiLookup(
  storage: StorageAdapter | null,
  key: string
): PendingImeiLookup | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof value.lookupId !== 'string' ||
      !UUID_PATTERN.test(value.lookupId) ||
      typeof value.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      typeof value.tier !== 'string' ||
      !isImeiServiceTierKey(value.tier)
    ) {
      throw new Error('Invalid pending IMEI lookup');
    }
    const device = IMEI_DEVICE_CATEGORIES.find(
      (category) => category.id === value.device
    )?.id;
    const categories: readonly ImeiDeviceCategory[] =
      IMEI_SERVICE_TIERS[value.tier].deviceCategories;
    const supportedDevice =
      device && categories.includes(device) ? device : undefined;
    return {
      createdAt: value.createdAt,
      lookupId: value.lookupId,
      tier: value.tier,
      ...(supportedDevice ? { device: supportedDevice } : {}),
    };
  } catch {
    clearPendingImeiLookup(storage, key);
    return null;
  }
}
