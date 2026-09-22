import { CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY } from '@/config/checkout-storage';
import { createKeyedSerialAsyncQueue } from '@/lib/create-keyed-serial-async-queue';

export type CheckoutCreditSnapshot = {
  savings_amount?: number;
  savings_goal_id?: string;
  use_savings_credit?: boolean;
  use_wallet_credit?: boolean;
  wallet_amount?: number;
};

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

// Each generation owns its snapshot key, so concurrent checkouts for
// different generations never share a read-modify-write cycle. The queue
// lives beside the records so both the apply path and the release
// compensation order their storage mutations on the same per-generation
// chain.
const enqueueSnapshotOperation = createKeyedSerialAsyncQueue();

function nextCreditApplySequence(): number {
  creditApplySequence += 1;
  return creditApplySequence;
}

function latestCreditApplyRecord(
  checkoutGeneration: string
): CreditApplyRecord | undefined {
  return creditApplyRecords.get(checkoutGeneration);
}

function completedCreditApplyChoice(
  checkoutGeneration: string
): CheckoutCreditSnapshot | undefined {
  // The frozen choice actually submitted under this generation, for
  // rollback paths that must re-freeze submitted values rather than the
  // live UI selections (a retry may have substituted stored values when
  // the shopper edited credit fields mid-flight).
  const latest = creditApplyRecords.get(checkoutGeneration);
  if (!latest || 'tombstone' in latest) {
    return undefined;
  }
  return latest.snapshot;
}

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

function noteCreditApplyTombstone(
  checkoutGeneration: string,
  sequence: number
): void {
  creditApplyRecords.set(checkoutGeneration, { sequence, tombstone: true });
}

function creditSnapshotKey(checkoutGeneration: string): string {
  return `${CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY}:${checkoutGeneration}`;
}

export const checkoutCreditSnapshotStore = {
  completedChoice: completedCreditApplyChoice,
  enqueue<T>(
    checkoutGeneration: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return enqueueSnapshotOperation(checkoutGeneration, operation);
  },
  key: creditSnapshotKey,
  latest: latestCreditApplyRecord,
  nextSequence: nextCreditApplySequence,
  noteCompleted: noteCompletedCreditApply,
  noteTombstone: noteCreditApplyTombstone,
  resetKey(checkoutGeneration: string): void {
    // Reset only the timed-out generation: other generations keep their
    // queued order instead of being detached onto a fresh chain.
    enqueueSnapshotOperation.resetKey(checkoutGeneration);
  },
};
