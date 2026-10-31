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
  recovery?: { storageKey: string; idempotencyKey: string };
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
    const recovery = value.recovery;
    const validRecovery =
      recovery &&
      typeof recovery === 'object' &&
      'storageKey' in recovery &&
      typeof recovery.storageKey === 'string' &&
      /^imei-attempt-v1-[0-9a-f]{64}$/.test(recovery.storageKey) &&
      'idempotencyKey' in recovery &&
      typeof recovery.idempotencyKey === 'string' &&
      UUID_PATTERN.test(recovery.idempotencyKey)
        ? {
            storageKey: recovery.storageKey,
            idempotencyKey: recovery.idempotencyKey,
          }
        : undefined;
    return {
      ...(validRecovery ? { recovery: validRecovery } : {}),
      createdAt: value.createdAt,
      lookupId: value.lookupId,
      tier: value.tier,
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
