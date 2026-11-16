import {
  type ImeiDeviceCategory,
  type ImeiServiceTierKey,
  isImeiServiceTierKey,
  resolveImeiReportDevice,
} from '@baci/shared/imei';
import AsyncStorage from '@react-native-async-storage/async-storage';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PendingImeiLookup {
  createdAt: string;
  lookupId: string;
  tier: ImeiServiceTierKey;
  device?: ImeiDeviceCategory;
  /** The signed-in user who started it: only they may resume it. */
  ownerUserId?: string;
  /**
   * The saved store credit key that started it (and its saved-key name): it
   * is retired only once this lookup's poll reports a final result, even
   * after a restart.
   */
  request?: { key: string; purchase: string };
}

export function pendingImeiStorageKey(merchantId: string, customerId: string) {
  return `baci:imei-pending:v1:${merchantId}:${customerId}`;
}

export async function savePendingImeiLookup(
  key: string,
  pending: PendingImeiLookup
) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

export async function clearPendingImeiLookup(key: string) {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    /* Recovery storage is optional. */
  }
}

function readRequest(value: unknown) {
  if (!value || typeof value !== 'object') return {};
  const { key, purchase } = value as Record<string, unknown>;
  return typeof key === 'string' &&
    UUID_PATTERN.test(key) &&
    typeof purchase === 'string' &&
    purchase
    ? { request: { key, purchase } }
    : {};
}

export async function loadPendingImeiLookup(
  key: string
): Promise<PendingImeiLookup | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
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
    return {
      createdAt: value.createdAt,
      lookupId: value.lookupId,
      tier: value.tier,
      ...(typeof value.ownerUserId === 'string' && value.ownerUserId
        ? { ownerUserId: value.ownerUserId }
        : {}),
      ...readRequest(value.request),
      ...(value.device == null
        ? {}
        : {
            device:
              resolveImeiReportDevice(value.tier, value.device) ?? undefined,
          }),
    };
  } catch {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      /* Recovery storage is optional. */
    }
    return null;
  }
}
