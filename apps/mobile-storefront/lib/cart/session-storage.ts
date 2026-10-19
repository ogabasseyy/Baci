import * as SecureStore from 'expo-secure-store';
import { cartSessionRecordSchema } from '@/schemas/cart-session-record';

export interface CartSessionStorage {
  retire?(merchantId: string): Promise<void>;
  getRetiredProof?(merchantId: string): Promise<string | null>;
  acknowledgeRetirement?(merchantId: string, proof: string): Promise<void>;
  getSession?(
    merchantId: string
  ): Promise<{ proof: string; ownerSubject: string | null } | null>;
  getOwnerSubject?(merchantId: string): Promise<string | null>;
  get(merchantId: string): Promise<string | null>;
  set(
    merchantId: string,
    proof: string,
    promotion?: {
      operationId: string;
      cartId: string;
      kind: 'create' | 'handoff' | 'account';
      ownerSubject?: string;
      fromActor?: string;
    }
  ): Promise<void>;
  getPromotionReceipt?(merchantId: string): Promise<{
    operationId: string;
    cartId: string;
    kind: 'create' | 'handoff' | 'account';
    ownerSubject?: string;
    fromActor?: string;
  } | null>;
  remove(merchantId: string): Promise<void>;
}
const queues = new Map<string, Promise<void>>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function key(merchantId: string): string {
  if (!uuid.test(merchantId)) throw new Error('Invalid cart merchant');
  return `baci.cart.session.${merchantId.toLowerCase()}`;
}
async function serialized<T>(
  storageKey: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = queues.get(storageKey) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  queues.set(storageKey, tail);
  try {
    return await result;
  } catch {
    throw new Error('Cart session storage unavailable');
  } finally {
    if (queues.get(storageKey) === tail) queues.delete(storageKey);
  }
}

function parseRecord(value: string | null) {
  if (value === null) return null;
  try {
    const raw: unknown = value.startsWith('cp1.')
      ? { proof: value }
      : JSON.parse(value);
    return cartSessionRecordSchema.parse(raw);
  } catch {
    // A corrupted or schema-drifted record reads as absent: reads
    // fail soft and the next write overwrites it, instead of every
    // storage operation throwing until the app is reinstalled.
    return null;
  }
}

/** Proofs never enter MMKV, AsyncStorage, query caches, or customer Auth keys. */
export const cartSessionStorage: CartSessionStorage = {
  get: async (merchantId) => {
    const storageKey = key(merchantId);
    return await serialized(storageKey, async () => {
      const record = parseRecord(await SecureStore.getItemAsync(storageKey));
      return record?.retired ? null : (record?.proof ?? null);
    });
  },
  getSession: async (merchantId) =>
    serialized(key(merchantId), async () => {
      const record = parseRecord(
        await SecureStore.getItemAsync(key(merchantId))
      );
      return !record || record.retired
        ? null
        : {
            proof: record.proof,
            ownerSubject:
              record.ownerSubject ?? record.promotion?.ownerSubject ?? null,
          };
    }),
  getOwnerSubject: async (merchantId) =>
    serialized(key(merchantId), async () => {
      const record = parseRecord(
        await SecureStore.getItemAsync(key(merchantId))
      );
      return record?.ownerSubject ?? record?.promotion?.ownerSubject ?? null;
    }),
  getPromotionReceipt: async (merchantId) => {
    return await serialized(
      key(merchantId),
      async () =>
        parseRecord(await SecureStore.getItemAsync(key(merchantId)))
          ?.promotion ?? null
    );
  },
  set: async (merchantId, proof, promotion) => {
    const storageKey = key(merchantId);
    if (
      !/^cp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(proof) ||
      proof.length > 8192
    )
      throw new Error('Invalid cart proof');
    await serialized(storageKey, async () => {
      const previous = parseRecord(await SecureStore.getItemAsync(storageKey));
      if (previous?.retired) throw new Error('Cart session retired');
      return SecureStore.setItemAsync(
        storageKey,
        JSON.stringify(
          cartSessionRecordSchema.parse({
            proof,
            promotion,
            ownerSubject:
              promotion?.kind === 'account'
                ? promotion.ownerSubject
                : previous?.ownerSubject,
          })
        ),
        // Device-only: a backup restored to new hardware must not carry
        // live device-grant authority with it.
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
    });
  },
  retire: async (merchantId) => {
    const storageKey = key(merchantId);
    await serialized(storageKey, async () => {
      const record = parseRecord(await SecureStore.getItemAsync(storageKey));
      if (record)
        await SecureStore.setItemAsync(
          storageKey,
          JSON.stringify({ ...record, retired: true }),
          { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
        );
    });
  },
  getRetiredProof: async (merchantId) =>
    serialized(key(merchantId), async () => {
      const record = parseRecord(
        await SecureStore.getItemAsync(key(merchantId))
      );
      return record?.retired ? record.proof : null;
    }),
  acknowledgeRetirement: async (merchantId, proof) =>
    serialized(key(merchantId), async () => {
      const record = parseRecord(
        await SecureStore.getItemAsync(key(merchantId))
      );
      if (record?.retired && record.proof === proof)
        await SecureStore.deleteItemAsync(key(merchantId));
    }),
  remove: async (merchantId) => {
    const storageKey = key(merchantId);
    await serialized(storageKey, () => SecureStore.deleteItemAsync(storageKey));
  },
};
