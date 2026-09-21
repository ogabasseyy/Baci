import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY } from '@/config/checkout-storage';
import { assertCheckoutRecoveryValue } from '@/lib/assert-checkout-recovery-value';
import { createSerialAsyncQueue } from '@/lib/create-serial-async-queue';

type CheckoutCreditSnapshot = {
  savings_amount?: number;
  savings_goal_id?: string;
  use_savings_credit?: boolean;
  use_wallet_credit?: boolean;
  wallet_amount?: number;
};

const CREDIT_KEYS = [
  'savings_amount',
  'savings_goal_id',
  'use_savings_credit',
  'use_wallet_credit',
  'wallet_amount',
] as const;

const enqueueCreditSnapshot = createSerialAsyncQueue();

function isCreditSnapshot(value: unknown): value is CheckoutCreditSnapshot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return CREDIT_KEYS.every((key) => {
    const entry = record[key];
    if (entry === undefined) {
      return true;
    }
    if (key === 'savings_goal_id') {
      return typeof entry === 'string';
    }
    if (key === 'use_savings_credit' || key === 'use_wallet_credit') {
      return typeof entry === 'boolean';
    }
    return typeof entry === 'number' && Number.isFinite(entry);
  });
}

function parseCreditMap(
  existing: string | null
): Record<string, CheckoutCreditSnapshot> {
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
  const map: Record<string, CheckoutCreditSnapshot> = {};
  for (const [generation, snapshot] of Object.entries(
    parsed as Record<string, unknown>
  )) {
    if (!isCreditSnapshot(snapshot)) {
      throw new Error(
        'Checkout recovery data is invalid. Please contact support.'
      );
    }
    map[generation] = snapshot;
  }
  return map;
}

function extractCheckoutCreditSnapshot(
  payload: Record<string, unknown>
): CheckoutCreditSnapshot {
  const snapshot: CheckoutCreditSnapshot = {};
  const walletAmount = payload.wallet_amount;
  if (typeof walletAmount === 'number' && Number.isFinite(walletAmount)) {
    snapshot.wallet_amount = walletAmount;
  }
  if (typeof payload.use_wallet_credit === 'boolean') {
    snapshot.use_wallet_credit = payload.use_wallet_credit;
  }
  const savingsAmount = payload.savings_amount;
  if (typeof savingsAmount === 'number' && Number.isFinite(savingsAmount)) {
    snapshot.savings_amount = savingsAmount;
  }
  if (typeof payload.savings_goal_id === 'string') {
    snapshot.savings_goal_id = payload.savings_goal_id;
  }
  if (typeof payload.use_savings_credit === 'boolean') {
    snapshot.use_savings_credit = payload.use_savings_credit;
  }
  return snapshot;
}

function omitCreditFields<T extends Record<string, unknown>>(payload: T): T {
  const next = { ...payload };
  for (const key of CREDIT_KEYS) {
    delete next[key];
  }
  return next;
}

async function readCreditMap() {
  return parseCreditMap(
    await AsyncStorage.getItem(CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY)
  );
}

async function writeCreditMap(map: Record<string, CheckoutCreditSnapshot>) {
  if (Object.keys(map).length === 0) {
    await AsyncStorage.removeItem(CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY);
    return;
  }
  await AsyncStorage.setItem(
    CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY,
    JSON.stringify(map)
  );
}

export function applyCheckoutCreditSnapshot<T extends Record<string, unknown>>(
  payload: T,
  checkoutGeneration: string
): Promise<T> {
  assertCheckoutRecoveryValue(checkoutGeneration, 'generation');
  return enqueueCreditSnapshot(async () => {
    const map = await readCreditMap();
    const stored = map[checkoutGeneration];
    if (stored) {
      return { ...omitCreditFields(payload), ...stored };
    }
    map[checkoutGeneration] = extractCheckoutCreditSnapshot(payload);
    await writeCreditMap(map);
    return payload;
  });
}

export async function releaseCheckoutCreditSnapshot(
  checkoutGeneration: string
): Promise<void> {
  assertCheckoutRecoveryValue(checkoutGeneration, 'generation');
  // Best-effort cleanup stays off the snapshot queue: callers bound it with
  // a storage timeout, and a hung cleanup must never wedge later checkouts
  // behind a poisoned tail. Generations are single-use, so a concurrent
  // apply for the released ID can only re-create an identical entry from
  // its frozen replay payload.
  const map = await readCreditMap();
  if (!(checkoutGeneration in map)) {
    return;
  }
  delete map[checkoutGeneration];
  await writeCreditMap(map);
}
