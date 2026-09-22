import { CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY } from '@/config/checkout-storage';

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

function nextCreditApplySequence(): number {
  creditApplySequence += 1;
  return creditApplySequence;
}

function latestCreditApplyRecord(
  checkoutGeneration: string
): CreditApplyRecord | undefined {
  return creditApplyRecords.get(checkoutGeneration);
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
  key: creditSnapshotKey,
  latest: latestCreditApplyRecord,
  nextSequence: nextCreditApplySequence,
  noteCompleted: noteCompletedCreditApply,
  noteTombstone: noteCreditApplyTombstone,
};
