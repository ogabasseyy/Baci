import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { getStorefrontStoragePrefix } from '@/lib/storefront-storage-prefix';

const pending = new Map<string, Promise<string>>();
export async function savingsDraftRequestId(
  scope: {
    userId: string;
    merchantId: string;
    productId: string;
    variantId: string | null;
  },
  expectedOldRequestId?: string
) {
  const prefix = getStorefrontStoragePrefix();
  if (!prefix) throw new Error('Local savings session is unavailable.');
  const key = `${prefix}savings-draft-request:${JSON.stringify(scope)}`;
  const existing = pending.get(key);
  const operation = (async () => {
    if (existing) await existing;
    const saved = await AsyncStorage.getItem(key);
    if (expectedOldRequestId !== undefined && saved !== expectedOldRequestId)
      throw new Error(
        'Saved draft request changed. Reopen your draft before starting another.'
      );
    if (saved !== null && expectedOldRequestId === undefined) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          saved
        )
      )
        throw new Error('Saved draft request needs review.');
      return saved;
    }
    const created = randomUUID();
    await AsyncStorage.setItem(key, created);
    if ((await AsyncStorage.getItem(key)) !== created)
      throw new Error('Unable to retain your draft request.');
    return created;
  })();
  pending.set(key, operation);
  try {
    return await operation;
  } finally {
    if (pending.get(key) === operation) pending.delete(key);
  }
}
