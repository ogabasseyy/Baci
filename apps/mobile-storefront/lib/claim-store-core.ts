import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY } from '@/config/checkout-storage';
import { createLogger } from '@/lib/logger';

import {
  parseTrackedOrderIds,
  serializeTrackedOrderIds,
} from './claim-store-codec';

export const log = createLogger('CheckoutTracking');

// Claims this process successfully granted. A timed-out write that lands
// late overwrites the envelope with its stale value, erasing claims granted
// after the queue was released; the compensating rollback reconciles those
// back instead of only removing the late claim. Union is idempotent, so
// older grants kept in the stale value are unaffected.
const grantedClaims = new Set<string>();

export function isClaimGranted(claim: string): boolean {
  return grantedClaims.has(claim);
}

export function addGrantedClaim(claim: string): void {
  grantedClaims.add(claim);
}

export function deleteGrantedClaim(claim: string): void {
  grantedClaims.delete(claim);
}

export function grantedClaimSnapshot(): string[] {
  return [...grantedClaims];
}

export function claimKey(orderId: string, eventName: string): string {
  return eventName === 'purchase' ? orderId : `${eventName}:${orderId}`;
}

// Persists an intended envelope merged with the in-process grant set, so a
// slow writer cannot erase claims granted after its value was computed.
// Only granted claims are merged: a read can observe a not-yet-removed
// phantom, and merging observed-but-ungranted entries would resurrect it.
// Grants imply emission happened, so they must persist unconditionally.
export function persistClaims(intended: string[]): Promise<void> {
  const merged = new Set(intended);
  for (const granted of grantedClaims) {
    merged.add(granted);
  }
  return AsyncStorage.setItem(
    CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY,
    serializeTrackedOrderIds([...merged])
  );
}

// Serializes concurrent claims so overlapping read-modify-write cycles
// cannot interleave: without it two claims in flight read the same stored
// array and the last write silently drops the first claim (lost update),
// letting that event emit twice.
let claimChain: Promise<void> = Promise.resolve();

export const CLAIM_STORAGE_TIMEOUT_MS = 3000;
// Upper bound on how long one claim can hold the queue while its storage
// settles. Past this point the queue is released so later claims still get
// their turn; a write that lands afterwards is still compensated by the
// rollback attached to the raw write promise.
const MAX_QUEUE_HOLD_MS = 10_000;
export const STORAGE_TIMEOUT = Symbol('claim-storage-timeout');

export function storageTimeout(): Promise<typeof STORAGE_TIMEOUT> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(STORAGE_TIMEOUT), CLAIM_STORAGE_TIMEOUT_MS);
  });
}

export async function readStoredClaims(): Promise<
  string[] | typeof STORAGE_TIMEOUT
> {
  const raw = await Promise.race([
    AsyncStorage.getItem(CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY),
    storageTimeout(),
  ]);
  if (raw === STORAGE_TIMEOUT) {
    return STORAGE_TIMEOUT;
  }
  return parseTrackedOrderIds(raw);
}

/**
 * Enqueues one claim task behind every earlier claim, release, or retry
 * task. The queue advances on storage *settlement*, not on the caller's
 * timeout: a write that started must land (or be rolled back) before the
 * next task reads, or the late write would clobber entries written after
 * the queue was released — but never longer than the maximum hold, or a
 * write that never settles would wedge every later task behind it.
 */
export function serializeClaimTask<Result extends { settled: Promise<void> }>(
  task: () => Promise<Result>
): Promise<Result> {
  const run = claimChain.then(task);
  claimChain = run.then(
    ({ settled }) =>
      Promise.race([
        settled,
        new Promise<void>((resolve) => {
          setTimeout(resolve, MAX_QUEUE_HOLD_MS);
        }),
      ]),
    () => undefined
  );
  return run;
}
