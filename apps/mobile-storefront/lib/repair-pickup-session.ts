import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { RepairBookingRequest } from '@/lib/repair-catalog-schemas';
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
  async load(data: RepairBookingRequest): Promise<RepairPickupSession | null> {
    const value = await SecureStore.getItemAsync(await key(data));
    return value ? repairPickupSchemas.session.parse(JSON.parse(value)) : null;
  },
  async save(data: RepairBookingRequest, session: RepairPickupSession) {
    await SecureStore.setItemAsync(
      await key(data),
      JSON.stringify(repairPickupSchemas.session.parse(session))
    );
  },
};
