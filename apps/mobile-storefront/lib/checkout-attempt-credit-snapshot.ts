import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY } from '@/config/checkout-storage';
import { assertCheckoutRecoveryValue } from '@/lib/assert-checkout-recovery-value';
import { createKeyedSerialAsyncQueue } from '@/lib/create-keyed-serial-async-queue';
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
let enqueueCreditSnapshot = createKeyedSerialAsyncQueue();

function resetCreditSnapshotQueue(): void {
  enqueueCreditSnapshot = createKeyedSerialAsyncQueue();
}

// Authoritative completed choice per generation: after a queue reset, an
// abandoned apply can settle late on its detached queue while a newer
// apply already froze a different choice. The sequence orders completions
// (a tombstone marks a released snapshot so a stale in-flight apply can
// never resurrect it), and readers adopt the authoritative choice instead
// of acting on clobbered content.
type CreditApplyRecord =
  | { sequence: number; snapshot: CheckoutCreditSnapshot }
  | { sequence: number; tombstone: true };

let creditApplySequence = 0;
const creditApplyRecords = new Map<string, CreditApplyRecord>();

function noteCompletedCreditApply(
  checkoutGeneration: string,
  sequence: number,
  snapshot: CheckoutCreditSnapshot
): void {
  const latest = creditApplyRecords.get(checkoutGeneration);
  if (!latest || sequence > latest.sequence) {
    creditApplyRecords.set(checkoutGeneration, { sequence, snapshot });
  }
}

function creditSnapshotsEqual(
  first: CheckoutCreditSnapshot,
  second: CheckoutCreditSnapshot
): boolean {
  return CREDIT_KEYS.every((key) => first[key] === second[key]);
}

async function restoreClobberedCreditSnapshot(
  checkoutGeneration: string,
  abandonedSequence: number
): Promise<void> {
  // A late write that lands after a newer apply completed is overwritten
  // back with the authoritative choice. Readers validate against the same
  // record, so even a read that lands in the repair window observes the
  // newer choice instead of the stale content.
  const latest = creditApplyRecords.get(checkoutGeneration);
  if (
    !latest ||
    'tombstone' in latest ||
    latest.sequence <= abandonedSequence
  ) {
    return;
  }
  const stored = parseCreditSnapshot(
    await AsyncStorage.getItem(creditSnapshotKey(checkoutGeneration))
  );
  if (!stored || !creditSnapshotsEqual(stored, latest.snapshot)) {
    await AsyncStorage.setItem(
      creditSnapshotKey(checkoutGeneration),
      JSON.stringify(latest.snapshot)
    );
  }
}

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
  // attempt instead of blocking checkout forever. When the queued apply
  // itself never settles, the queue is reset so later checkouts for the
  // same generation are not wedged behind it; genuine failures keep their
  // order. A reset apply that settles late cannot clobber the newer
  // choice: readers adopt the authoritative completed choice, and the
  // abandoned write is overwritten back if it lands after one.
  const applySequence = ++creditApplySequence;
  let settled = false;
  const attempt = enqueueCreditSnapshot(checkoutGeneration, async () => {
    const stored = parseCreditSnapshot(
      await AsyncStorage.getItem(creditSnapshotKey(checkoutGeneration))
    );
    const latest = creditApplyRecords.get(checkoutGeneration);
    if (
      latest &&
      !('tombstone' in latest) &&
      (!stored || !creditSnapshotsEqual(stored, latest.snapshot))
    ) {
      noteCompletedCreditApply(
        checkoutGeneration,
        applySequence,
        latest.snapshot
      );
      return { ...omitCreditFields(payload), ...latest.snapshot };
    }
    if (stored) {
      noteCompletedCreditApply(checkoutGeneration, applySequence, stored);
      return { ...omitCreditFields(payload), ...stored };
    }
    const snapshot = extractCheckoutCreditSnapshot(payload);
    await AsyncStorage.setItem(
      creditSnapshotKey(checkoutGeneration),
      JSON.stringify(snapshot)
    );
    noteCompletedCreditApply(checkoutGeneration, applySequence, snapshot);
    return payload;
  });
  void attempt.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  return withCheckoutStorageTimeout(
    attempt,
    undefined,
    'Checkout storage read timed out'
  ).catch((error: unknown) => {
    if (!settled) {
      resetCreditSnapshotQueue();
      void attempt.then(
        () =>
          restoreClobberedCreditSnapshot(
            checkoutGeneration,
            applySequence
          ).catch(() => undefined),
        () => undefined
      );
    }
    throw error;
  });
}

export async function releaseCheckoutCreditSnapshot(
  checkoutGeneration: string
): Promise<void> {
  assertCheckoutRecoveryValue(checkoutGeneration, 'generation');
  // Best-effort cleanup deletes only this generation's key: it cannot drop
  // another checkout's snapshot, and it never waits on the apply queue, so
  // a hung apply cannot wedge payment completion. The tombstone retires the
  // completed choice so a stale in-flight apply can never resurrect it and
  // the next apply freezes fresh fields.
  creditApplyRecords.set(checkoutGeneration, {
    sequence: ++creditApplySequence,
    tombstone: true,
  });
  await AsyncStorage.removeItem(creditSnapshotKey(checkoutGeneration));
}
