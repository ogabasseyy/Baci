import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { getStorefrontStoragePrefix } from '@/lib/storefront-storage-prefix';
import {
  type SavingsFirstCardCheckoutSchemas as schemas,
  SavingsFirstCardCheckoutSnapshotSchema as snapshotSchema,
} from '@/schemas/savings-first-card-checkout';

export type SavingsFirstCardCheckoutSnapshot = ReturnType<
  typeof snapshotSchema.parse
>;
export type SavingsFirstCardScope = {
  userId: string;
  merchantId: string;
  goalId: string;
};

const writeTails = new Map<string, Promise<void>>();
const uncertainWrites = new Set<string>();

function keyFor(scope: SavingsFirstCardScope) {
  return `${getStorefrontStoragePrefix()}savings-first-card-checkout:${JSON.stringify(
    [scope.userId, scope.merchantId, scope.goalId]
  )}`;
}

async function withScopeLock<T>(key: string, action: () => Promise<T>) {
  const previous = writeTails.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  writeTails.set(key, tail);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (writeTails.get(key) === tail) writeTails.delete(key);
  }
}

async function readAtKey(key: string, goalId: string) {
  if (uncertainWrites.has(key))
    throw new Error('Saved request state is uncertain. Check status first.');
  const stored = await AsyncStorage.getItem(key);
  if (stored === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    throw new Error('Saved first-card checkout needs review.');
  }
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success || parsed.data.goalId !== goalId)
    throw new Error('Saved first-card checkout needs review.');
  return parsed.data;
}

export async function readSavingsFirstCardCheckoutSnapshot(
  scope: SavingsFirstCardScope
) {
  return await readAtKey(keyFor(scope), scope.goalId);
}

export async function saveSavingsFirstCardCheckoutSnapshot(
  scope: SavingsFirstCardScope,
  input: Omit<ReturnType<typeof schemas.request.parse>, 'idempotencyKey'>
) {
  const key = keyFor(scope);
  return await withScopeLock(key, async () => {
    if (uncertainWrites.has(key))
      throw new Error('Saved request state is uncertain. Check status first.');
    const existing = await readAtKey(key, scope.goalId);
    if (existing) {
      if (
        existing.goalId !== input.goalId ||
        existing.amountKobo !== input.amountKobo ||
        JSON.stringify(existing.consent) !== JSON.stringify(input.consent)
      )
        throw new Error('An earlier first-card checkout is unresolved.');
      return existing;
    }
    const snapshot = snapshotSchema.parse({
      ...input,
      idempotencyKey: randomUUID(),
      intentId: null,
    });
    await writeAndVerify(key, snapshot);
    return snapshot;
  });
}

export async function recordSavingsFirstCardCheckoutState(
  scope: SavingsFirstCardScope,
  expectedKey: string,
  state: ReturnType<typeof schemas.publicState.parse>
) {
  const key = keyFor(scope);
  return await withScopeLock(key, async () => {
    const current = await readAtKey(key, scope.goalId);
    if (!current || current.idempotencyKey !== expectedKey)
      throw new Error('Saved first-card request changed.');
    if (
      current.goalId !== state.goalId ||
      current.amountKobo !== state.amountKobo ||
      (current.intentId !== null && current.intentId !== state.intentId)
    )
      throw new Error(
        'First-card checkout state does not match the saved request.'
      );
    const next = snapshotSchema.parse({
      ...current,
      intentId: state.intentId,
      status: state.status,
      ...(state.authorizationUrl
        ? { authorizationUrl: state.authorizationUrl }
        : { authorizationUrl: undefined }),
    });
    await writeAndVerify(key, next);
    return next;
  });
}

export async function clearCompletedSavingsFirstCardCheckoutSnapshot(
  scope: SavingsFirstCardScope,
  expectedKey: string
) {
  const key = keyFor(scope);
  return await withScopeLock(key, async () => {
    const existing = await readAtKey(key, scope.goalId);
    if (
      !existing ||
      existing.idempotencyKey !== expectedKey ||
      existing.status !== 'completed'
    )
      throw new Error('Only a canonically completed checkout can be cleared.');
    await AsyncStorage.removeItem(key);
    if ((await AsyncStorage.getItem(key)) !== null) {
      uncertainWrites.add(key);
      throw new Error('Unable to clear the completed checkout safely.');
    }
    uncertainWrites.delete(key);
  });
}

export async function clearRetiredSavingsFirstCardCheckoutSnapshot(
  scope: SavingsFirstCardScope,
  expectedKey: string,
  expectedIntentId: string
) {
  const key = keyFor(scope);
  return await withScopeLock(key, async () => {
    const existing = await readAtKey(key, scope.goalId);
    if (
      !existing ||
      existing.idempotencyKey !== expectedKey ||
      existing.intentId !== expectedIntentId
    )
      throw new Error('Only the matching retired checkout can be cleared.');
    uncertainWrites.add(key);
    await AsyncStorage.removeItem(key);
    if ((await AsyncStorage.getItem(key)) !== null) {
      throw new Error('Unable to clear the retired checkout safely.');
    }
    uncertainWrites.delete(key);
  });
}

async function writeAndVerify(
  key: string,
  snapshot: SavingsFirstCardCheckoutSnapshot
) {
  const serialized = JSON.stringify(snapshot);
  uncertainWrites.add(key);
  await AsyncStorage.setItem(key, serialized);
  if ((await AsyncStorage.getItem(key)) !== serialized) {
    throw new Error('Saved request state is uncertain.');
  }
  uncertainWrites.delete(key);
}
