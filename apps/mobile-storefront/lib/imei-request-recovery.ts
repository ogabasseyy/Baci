import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const PREFIX = 'imei-attempt-v1-';
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

export async function acquireImeiRecoveryKey(
  identity: readonly string[],
  createKey: () => string
) {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(identity)
  );
  const storageKey = `${PREFIX}${digest}`;
  return serialize(async () => {
    const existing = await SecureStore.getItemAsync(storageKey);
    if (existing) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          existing
        )
      )
        throw new Error('Invalid stored recovery key');
      return { storageKey, idempotencyKey: existing, isExisting: true };
    }
    const idempotencyKey = createKey();
    await SecureStore.setItemAsync(storageKey, idempotencyKey);
    return { storageKey, idempotencyKey, isExisting: false };
  });
}

export async function clearImeiRecoveryKey(
  storageKey: string,
  idempotencyKey: string
) {
  if (!/^imei-attempt-v1-[0-9a-f]{64}$/.test(storageKey))
    throw new Error('Invalid recovery key');
  await serialize(async () => {
    if ((await SecureStore.getItemAsync(storageKey)) === idempotencyKey)
      await SecureStore.deleteItemAsync(storageKey);
  });
}
