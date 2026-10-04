import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { getStorefrontStoragePrefix } from '@/lib/storefront-storage-prefix';
import { SavingsCardContributionSnapshotSchema } from '@/schemas/savings-card-contributions';

export type SavingsCardContributionSnapshot = {
  goalId: string;
  savedMethodId: string;
  amountKobo: number;
  idempotencyKey: string;
  consent: { version: 'prefunded-card-v1'; oneTimeCharge: true };
};
type Scope = { userId: string; merchantId: string; goalId: string };
type TerminalStatus = 'completed' | 'collection_failed';

const writeTails = new Map<string, Promise<void>>();
const uncertainWrites = new Set<string>();

function keyFor(scope: Scope) {
  return `${getStorefrontStoragePrefix()}savings-card-contribution:${JSON.stringify([
    scope.userId,
    scope.merchantId,
    scope.goalId,
  ])}`;
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
  const stored = await AsyncStorage.getItem(key);
  if (stored === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    throw new Error('Saved card contribution needs review.');
  }
  const parsed = SavingsCardContributionSnapshotSchema.safeParse(value);
  if (!parsed.success || parsed.data.goalId !== goalId)
    throw new Error('Saved card contribution needs review.');
  return parsed.data;
}

export async function readSavingsCardContributionSnapshot(scope: Scope) {
  return await readAtKey(keyFor(scope), scope.goalId);
}

export async function saveSavingsCardContributionSnapshot(
  scope: Scope,
  input: Omit<SavingsCardContributionSnapshot, 'idempotencyKey'>
) {
  const key = keyFor(scope);
  return await withScopeLock(key, async () => {
    if (uncertainWrites.has(key))
      throw new Error('Saved request state is uncertain. Check its status first.');
    const existing = await readAtKey(key, scope.goalId);
    if (existing) {
      const samePayload = existing.goalId === input.goalId &&
        existing.savedMethodId === input.savedMethodId &&
        existing.amountKobo === input.amountKobo &&
        existing.consent.version === input.consent.version &&
        existing.consent.oneTimeCharge === input.consent.oneTimeCharge;
      if (!samePayload)
        throw new Error('An earlier contribution is unresolved. Check its status first.');
      return existing;
    }
    const snapshot = SavingsCardContributionSnapshotSchema.parse({
      ...input,
      idempotencyKey: randomUUID(),
    });
    const serialized = JSON.stringify(snapshot);
    await AsyncStorage.setItem(key, serialized);
    if ((await AsyncStorage.getItem(key)) !== serialized) {
      uncertainWrites.add(key);
      throw new Error('Saved request state is uncertain. Check its status first.');
    }
    return snapshot;
  });
}

export async function clearTerminalSavingsCardContributionSnapshot(
  scope: Scope,
  expectedKey: string,
  status: TerminalStatus
) {
  const key = keyFor(scope);
  return await withScopeLock(key, async () => {
    if (status !== 'completed' && status !== 'collection_failed')
      throw new Error('Only a confirmed terminal contribution can be replaced.');
    const existing = await readAtKey(key, scope.goalId);
    if (!existing || existing.idempotencyKey !== expectedKey)
      throw new Error('Saved contribution changed. Check its status again.');
    await AsyncStorage.removeItem(key);
    if ((await AsyncStorage.getItem(key)) !== null) {
      uncertainWrites.add(key);
      throw new Error('Unable to clear the completed contribution safely.');
    }
    uncertainWrites.delete(key);
  });
}
