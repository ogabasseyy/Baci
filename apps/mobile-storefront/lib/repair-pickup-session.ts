import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { RepairBookingRequest } from '@/lib/repair-catalog-schemas';
import { repairPickupPaymentAttempt } from '@/lib/repair-pickup-payment-attempt';
import {
  type RepairPickupSession,
  repairPickupSchemas,
} from '@/schemas/repair-pickup';

async function key(data: RepairBookingRequest) {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify([
      Constants.expoConfig?.extra?.merchantSlug || 'ogabassey',
      data,
    ])
  );
  return `repair-pickup-${digest}`;
}

export const repairPickupSession = {
  async clear(data: RepairBookingRequest) {
    await repairPickupPaymentAttempt.clear(data);
    await SecureStore.deleteItemAsync(await key(data));
  },
  async load(data: RepairBookingRequest): Promise<RepairPickupSession | null> {
    const storageKey = await key(data);
    const value = await SecureStore.getItemAsync(storageKey);
    if (!value) return null;
    try {
      return repairPickupSchemas.session.parse(JSON.parse(value));
    } catch {
      // Reset corrupt UI recovery only; preserve the durable payment attempt.
      await SecureStore.deleteItemAsync(storageKey);
      return null;
    }
  },
  async save(data: RepairBookingRequest, session: RepairPickupSession) {
    await SecureStore.setItemAsync(
      await key(data),
      JSON.stringify(repairPickupSchemas.session.parse(session))
    );
  },
};
