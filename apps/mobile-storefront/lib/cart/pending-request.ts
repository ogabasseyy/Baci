import * as SecureStore from 'expo-secure-store';

export interface PendingCartRequest {
  actor: string;
  operationId: string;
  body: unknown;
}
const queues = new Map<string, Promise<void>>();
const chunkSize = 1200;
const maxChunks = 64;
function key(merchant: string): string {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(merchant))
    throw new Error('Invalid cart merchant');
  return `baci.cart.pending.${merchant.toLowerCase()}`;
}
async function locked<T>(
  merchant: string,
  run: (base: string) => Promise<T>
): Promise<T> {
  const base = key(merchant);
  const result = (queues.get(base) ?? Promise.resolve()).then(() => run(base));
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  queues.set(base, tail);
  try {
    return await result;
  } catch {
    throw new Error('Cart request storage unavailable');
  } finally {
    if (queues.get(base) === tail) queues.delete(base);
  }
}
interface Manifest {
  count: number;
  ready: boolean;
}
async function manifest(base: string): Promise<Manifest | null> {
  const value = await SecureStore.getItemAsync(base);
  if (value === null) return null;
  const raw: unknown = JSON.parse(value);
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('count' in raw) ||
    !Number.isInteger(raw.count) ||
    typeof raw.count !== 'number' ||
    raw.count < 1 ||
    raw.count > maxChunks ||
    !('ready' in raw) ||
    typeof raw.ready !== 'boolean'
  )
    throw new Error('Invalid pending cart manifest');
  return { count: raw.count, ready: raw.ready };
}
async function remove(base: string, count: number): Promise<void> {
  // Keep the manifest until all chunks have been removed: failed cleanup is retryable.
  for (let i = 0; i < count; i++)
    await SecureStore.deleteItemAsync(`${base}.${i}`);
  await SecureStore.deleteItemAsync(base);
}
async function read(base: string): Promise<PendingCartRequest | null> {
  const index = await manifest(base);
  if (!index) return null;
  if (!index.ready) {
    await remove(base, index.count);
    return null;
  }
  let encoded = '';
  for (let i = 0; i < index.count; i++) {
    const chunk = await SecureStore.getItemAsync(`${base}.${i}`);
    if (chunk === null || chunk.length > chunkSize)
      throw new Error('Incomplete cart request');
    encoded += chunk;
  }
  const value: unknown = JSON.parse(decodeURIComponent(encoded));
  if (
    !value ||
    typeof value !== 'object' ||
    !('actor' in value) ||
    typeof value.actor !== 'string' ||
    !value.actor ||
    !('operationId' in value) ||
    typeof value.operationId !== 'string' ||
    !value.operationId ||
    value.operationId.length > 128 ||
    !('body' in value)
  )
    throw new Error('Invalid cart request');
  return {
    actor: value.actor,
    operationId: value.operationId,
    body: value.body,
  };
}

/** One sent intent, not an offline queue. Authority never enters display persistence. */
export const pendingCartRequest = {
  read: (merchant: string) => locked(merchant, read),
  save: (merchant: string, request: PendingCartRequest) =>
    locked(merchant, async (base) => {
      const existing = await read(base);
      if (existing) {
        if (JSON.stringify(existing) === JSON.stringify(request)) return;
        throw new Error('Unresolved cart request');
      }
      if (
        !request.actor ||
        !request.operationId ||
        request.operationId.length > 128
      )
        throw new Error('Invalid cart request');
      // ASCII encoding keeps each SecureStore value bounded in bytes, including Unicode options.
      const encoded = encodeURIComponent(JSON.stringify(request));
      const count = Math.ceil(encoded.length / chunkSize);
      if (count < 1 || count > maxChunks)
        throw new Error('Cart request too large');
      await SecureStore.setItemAsync(
        base,
        JSON.stringify({ count, ready: false })
      );
      for (let i = 0; i < count; i++)
        await SecureStore.setItemAsync(
          `${base}.${i}`,
          encoded.slice(i * chunkSize, (i + 1) * chunkSize)
        );
      // Callers may transmit only after this final write has completed.
      await SecureStore.setItemAsync(
        base,
        JSON.stringify({ count, ready: true })
      );
    }),
  clear: (merchant: string, operationId: string) =>
    locked(merchant, async (base) => {
      const request = await read(base);
      if (request?.operationId !== operationId) return;
      const index = await manifest(base);
      if (index) {
        // An interrupted deletion must recover as cleanup, never as a corrupt replay.
        await SecureStore.setItemAsync(
          base,
          JSON.stringify({ ...index, ready: false })
        );
        await remove(base, index.count);
      }
    }),
};
