import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_AUTH_PARTITION_STORAGE_KEY } from '@/config/checkout-storage';

const GUEST_AUTH_PARTITION = 'guest';

let partitionGate: Promise<void> = Promise.resolve();

function assertAuthPartition(value: string): void {
  if (value === GUEST_AUTH_PARTITION) return;
  if (!/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error(
      'Checkout recovery auth partition is invalid. Please contact support.'
    );
  }
}

function parsePartitionMap(existing: string | null): Record<string, string> {
  if (existing === null) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    throw new Error(
      'Checkout recovery data is invalid. Please contact support.'
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      'Checkout recovery data is invalid. Please contact support.'
    );
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.generation === 'string' &&
    typeof record.userId === 'string'
  ) {
    assertAuthPartition(record.userId);
    return { [record.generation]: record.userId };
  }
  const map: Record<string, string> = {};
  for (const [generation, userId] of Object.entries(record)) {
    if (typeof userId === 'string') {
      assertAuthPartition(userId);
      map[generation] = userId;
    }
  }
  return map;
}

async function resolveCheckoutAuthPartitionUnlocked(
  checkoutGeneration: string,
  currentUserId: string | undefined,
  sessionReadInconclusive: boolean
): Promise<string> {
  const existing = await AsyncStorage.getItem(
    CHECKOUT_AUTH_PARTITION_STORAGE_KEY
  );
  const partitions = parsePartitionMap(existing);
  const stored = partitions[checkoutGeneration];
  const incoming = currentUserId ?? GUEST_AUTH_PARTITION;

  if (sessionReadInconclusive) {
    if (stored !== undefined) {
      assertAuthPartition(stored);
      return stored;
    }
    throw new Error('Checkout session read timed out');
  }

  if (stored !== undefined) {
    assertAuthPartition(stored);
    if (stored !== GUEST_AUTH_PARTITION && incoming !== stored) {
      assertAuthPartition(incoming);
      partitions[checkoutGeneration] = incoming;
      await AsyncStorage.setItem(
        CHECKOUT_AUTH_PARTITION_STORAGE_KEY,
        JSON.stringify(partitions)
      );
      return incoming;
    }
    return stored;
  }

  assertAuthPartition(incoming);
  partitions[checkoutGeneration] = incoming;
  await AsyncStorage.setItem(
    CHECKOUT_AUTH_PARTITION_STORAGE_KEY,
    JSON.stringify(partitions)
  );
  return incoming;
}

export async function resolveCheckoutAuthPartition(
  checkoutGeneration: string,
  currentUserId: string | undefined,
  options?: { sessionReadInconclusive?: boolean }
): Promise<string> {
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = partitionGate;
  partitionGate = next;
  await previous;
  try {
    return await resolveCheckoutAuthPartitionUnlocked(
      checkoutGeneration,
      currentUserId,
      options?.sessionReadInconclusive === true
    );
  } finally {
    release();
  }
}
