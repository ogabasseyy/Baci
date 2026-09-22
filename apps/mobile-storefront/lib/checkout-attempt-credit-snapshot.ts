import AsyncStorage from '@react-native-async-storage/async-storage';
import { assertCheckoutRecoveryValue } from '@/lib/assert-checkout-recovery-value';
import {
  type CheckoutCreditSnapshot,
  checkoutCreditSnapshotStore,
} from '@/lib/checkout-credit-snapshot-store';
import { withCheckoutStorageTimeout } from '@/lib/with-checkout-storage-timeout';

const CREDIT_KEYS = [
  'savings_amount',
  'savings_goal_id',
  'use_savings_credit',
  'use_wallet_credit',
  'wallet_amount',
] as const;

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
  const latest = checkoutCreditSnapshotStore.latest(checkoutGeneration);
  if (!latest || latest.sequence <= abandonedSequence) {
    return;
  }
  if ('tombstone' in latest) {
    // The generation was released after the abandoned apply started, so the
    // write that just landed is stale residue on top of the removal. Repair
    // it through the generation queue — re-checking authority inside the
    // queued op — so the removal cannot slip between a newer apply's read
    // and write and delete a freshly frozen choice.
    await checkoutCreditSnapshotStore
      .enqueue(checkoutGeneration, async () => {
        const current = checkoutCreditSnapshotStore.latest(checkoutGeneration);
        if (
          !current ||
          !('tombstone' in current) ||
          current.sequence <= abandonedSequence
        ) {
          return;
        }
        await AsyncStorage.removeItem(
          checkoutCreditSnapshotStore.key(checkoutGeneration)
        );
      })
      .catch(() => undefined);
    return;
  }
  const stored = parseCreditSnapshot(
    await AsyncStorage.getItem(
      checkoutCreditSnapshotStore.key(checkoutGeneration)
    )
  );
  if (!stored || !creditSnapshotsEqual(stored, latest.snapshot)) {
    await AsyncStorage.setItem(
      checkoutCreditSnapshotStore.key(checkoutGeneration),
      JSON.stringify(latest.snapshot)
    );
  }
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
  const applySequence = checkoutCreditSnapshotStore.nextSequence();
  let settled = false;
  const attempt = checkoutCreditSnapshotStore.enqueue(
    checkoutGeneration,
    async () => {
      const stored = parseCreditSnapshot(
        await AsyncStorage.getItem(
          checkoutCreditSnapshotStore.key(checkoutGeneration)
        )
      );
      const latest = checkoutCreditSnapshotStore.latest(checkoutGeneration);
      if (latest && 'tombstone' in latest) {
        // The generation was released, so no frozen choice exists: any stored
        // content is a late write from an abandoned attempt, not a choice to
        // adopt. Freeze fresh fields so a retry after a definitive rejection
        // never stays stuck on the rejected credit.
        const snapshot = extractCheckoutCreditSnapshot(payload);
        await AsyncStorage.setItem(
          checkoutCreditSnapshotStore.key(checkoutGeneration),
          JSON.stringify(snapshot)
        );
        checkoutCreditSnapshotStore.noteCompleted(
          checkoutGeneration,
          applySequence,
          snapshot
        );
        return payload;
      }
      if (
        latest &&
        (!stored || !creditSnapshotsEqual(stored, latest.snapshot))
      ) {
        checkoutCreditSnapshotStore.noteCompleted(
          checkoutGeneration,
          applySequence,
          latest.snapshot
        );
        return { ...omitCreditFields(payload), ...latest.snapshot };
      }
      if (stored) {
        checkoutCreditSnapshotStore.noteCompleted(
          checkoutGeneration,
          applySequence,
          stored
        );
        return { ...omitCreditFields(payload), ...stored };
      }
      const snapshot = extractCheckoutCreditSnapshot(payload);
      await AsyncStorage.setItem(
        checkoutCreditSnapshotStore.key(checkoutGeneration),
        JSON.stringify(snapshot)
      );
      checkoutCreditSnapshotStore.noteCompleted(
        checkoutGeneration,
        applySequence,
        snapshot
      );
      return payload;
    }
  );
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
      checkoutCreditSnapshotStore.resetKey(checkoutGeneration);
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
