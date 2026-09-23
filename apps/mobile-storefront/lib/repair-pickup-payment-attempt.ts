import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { RepairBookingRequest } from '@/lib/repair-catalog-schemas';
import {
  type RepairPickupAttempt,
  repairPickupAttemptSchema,
} from '@/schemas/repair-pickup-attempt';

async function key(data: RepairBookingRequest) {
  return `repair-pickup-attempt-${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([Constants.expoConfig?.extra?.merchantSlug || 'ogabassey', data]))}`;
}
type Attempt = RepairPickupAttempt;
const pending = new Map<string, Promise<Attempt>>();
const retired = new Set<string>();
const RETIRED_TOMBSTONE = JSON.stringify({ retired: true });

function isRetiredTombstone(raw: string): boolean {
  try {
    return (JSON.parse(raw) as { retired?: unknown } | null)?.retired === true;
  } catch {
    return false;
  }
}

export const repairPickupPaymentAttempt = {
  async get(
    data: RepairBookingRequest,
    expectedPickupFee: number,
    resumeToken?: string
  ): Promise<Attempt> {
    const storageKey = await key(data);
    const existing = pending.get(storageKey);
    if (existing) return existing;
    const task = (async () => {
      const raw = retired.has(storageKey)
        ? null
        : await SecureStore.getItemAsync(storageKey);
      if (raw && !isRetiredTombstone(raw)) {
        try {
          return repairPickupAttemptSchema.parse(JSON.parse(raw));
        } catch {
          // Truncated JSON or a schema-incompatible record must not wedge
          // retries: drop it (best effort) and fall through to a fresh
          // durable attempt, whose write overwrites the invalid value.
          await SecureStore.deleteItemAsync(storageKey).catch(() => undefined);
        }
      }
      const requestId = Crypto.randomUUID();
      // Fail before sending if retry identity cannot be durably saved.
      await SecureStore.setItemAsync(
        storageKey,
        JSON.stringify({ requestId, expectedPickupFee, resumeToken })
      );
      retired.delete(storageKey);
      return { requestId, expectedPickupFee, resumeToken };
    })();
    pending.set(storageKey, task);
    try {
      return await task;
    } finally {
      pending.delete(storageKey);
    }
  },
  async clear(data: RepairBookingRequest) {
    const storageKey = await key(data);
    // A definitive response retires this attempt in memory even if deletion
    // fails. A replacement must still be written successfully before sending.
    retired.add(storageKey);
    try {
      await SecureStore.deleteItemAsync(storageKey);
    } catch (error) {
      // Deletion failed: persist a tombstone so a restart cannot replay the
      // retired attempt, then report the storage failure.
      await SecureStore.setItemAsync(storageKey, RETIRED_TOMBSTONE);
      throw error;
    }
    retired.delete(storageKey);
  },
};
