import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { RepairBookingRequest } from '@/lib/repair-catalog-schemas';
import { repairPickupAttemptSchema } from '@/schemas/repair-pickup-attempt';

async function key(data: RepairBookingRequest) {
  return `repair-pickup-attempt-${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([Constants.expoConfig?.extra?.merchantSlug || 'ogabassey', data]))}`;
}
const pending = new Map<string, Promise<string>>();

export const repairPickupPaymentAttempt = {
  async get(
    data: RepairBookingRequest,
    expectedPickupFee: number,
    resumeToken?: string
  ): Promise<string> {
    const storageKey = await key(data);
    const existing = pending.get(storageKey);
    if (existing) return existing;
    const task = (async () => {
      const raw = await SecureStore.getItemAsync(storageKey);
      if (raw) {
        const saved = repairPickupAttemptSchema.parse(JSON.parse(raw));
        if (
          saved.expectedPickupFee !== expectedPickupFee ||
          saved.resumeToken !== resumeToken
        )
          throw new Error(
            'Recover the previous pickup payment before changing its details.'
          );
        return saved.requestId;
      }
      const requestId = Crypto.randomUUID();
      // Fail before sending if retry identity cannot be durably saved.
      await SecureStore.setItemAsync(
        storageKey,
        JSON.stringify({ requestId, expectedPickupFee, resumeToken })
      );
      return requestId;
    })();
    pending.set(storageKey, task);
    try {
      return await task;
    } finally {
      pending.delete(storageKey);
    }
  },
  async clear(data: RepairBookingRequest) {
    await SecureStore.deleteItemAsync(await key(data));
  },
};
