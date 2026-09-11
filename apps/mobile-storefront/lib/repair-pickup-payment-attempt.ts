import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { RepairBookingRequest } from '@/lib/repair-catalog-schemas';
import { repairPickupAttemptSchema } from '@/schemas/repair-pickup-attempt';

async function key(data: RepairBookingRequest) {
  return `repair-pickup-attempt-${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([Constants.expoConfig?.extra?.merchantSlug || 'ogabassey', data]))}`;
}
type Attempt = {
  requestId: string;
  expectedPickupFee: number;
  resumeToken?: string;
};
const pending = new Map<string, Promise<Attempt>>();
const retired = new Set<string>();

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
      if (raw) {
        return repairPickupAttemptSchema.parse(JSON.parse(raw));
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
    await SecureStore.deleteItemAsync(storageKey);
    retired.delete(storageKey);
  },
};
