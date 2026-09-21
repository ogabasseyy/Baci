import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY } from '@/config/checkout-storage';
import { assertCheckoutRecoveryValue } from '@/lib/assert-checkout-recovery-value';
import { createKeyedSerialAsyncQueue } from '@/lib/create-serial-async-queue';
import { withCheckoutStorageTimeout } from '@/lib/with-checkout-storage-timeout';

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

// Each generation owns its snapshot key, so concurrent checkouts for
// different generations never share a read-modify-write cycle.
const enqueueCreditSnapshot = createKeyedSerialAsyncQueue();

function creditSnapshotKey(checkoutGeneration: string): string {
  return `${CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY}:${checkoutGeneration}`;
}

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

function parseCreditSnapshot(
  existing: string | null
): CheckoutCreditSnapshot | undefined {
  if (existing === null) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    throw new Error(
      'Checkout recovery data is invalid. Please contact support.'
    );
  }
  if (!isCreditSnapshot(parsed)) {
    throw new Error(
      'Checkout recovery data is invalid. Please contact support.'
    );
  }
  return parsed;
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

export function applyCheckoutCreditSnapshot<T extends Record<string, unknown>>(
  payload: T,
  checkoutGeneration: string
): Promise<T> {
  assertCheckoutRecoveryValue(checkoutGeneration, 'generation');
  // Same-generation applies stay serialized so concurrent submits observe a
  // single frozen choice. The wait is bounded: a hung store fails the
  // attempt instead of wedging later checkouts, and the queue drains itself
  // once storage recovers.
  return withCheckoutStorageTimeout(
    enqueueCreditSnapshot(checkoutGeneration, async () => {
      const stored = parseCreditSnapshot(
        await AsyncStorage.getItem(creditSnapshotKey(checkoutGeneration))
      );
      if (stored) {
        return { ...omitCreditFields(payload), ...stored };
      }
      await AsyncStorage.setItem(
        creditSnapshotKey(checkoutGeneration),
        JSON.stringify(extractCheckoutCreditSnapshot(payload))
      );
      return payload;
    }),
    undefined,
    'Checkout storage read timed out'
  );
}

export async function releaseCheckoutCreditSnapshot(
  checkoutGeneration: string
): Promise<void> {
  assertCheckoutRecoveryValue(checkoutGeneration, 'generation');
  // Best-effort cleanup deletes only this generation's key: it cannot drop
  // another checkout's snapshot, and it never waits on the apply queue, so
  // a hung apply cannot wedge payment completion.
  await AsyncStorage.removeItem(creditSnapshotKey(checkoutGeneration));
}
