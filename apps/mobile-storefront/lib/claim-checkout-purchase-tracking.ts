import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY } from '@/config/checkout-storage';
import { createLogger } from '@/lib/logger';

import {
  parseTrackedOrderIds,
  serializeTrackedOrderIds,
} from './claim-store-codec';

const log = createLogger('CheckoutTracking');
// Serializes concurrent claims so overlapping read-modify-write cycles
// cannot interleave: without it two claims in flight read the same stored
// array and the last write silently drops the first claim (lost update),
// letting that event emit twice. The queue stays serialized on storage
// *settlement*, not on the caller's timeout: a write that started must land
// (or be rolled back) before the next claim reads, or the late write would
// clobber claims written after the queue was released.
// Claims this process successfully granted. A timed-out write that lands
// late overwrites the envelope with its stale value, erasing claims granted
// after the queue was released; the compensating rollback reconciles those
// back instead of only removing the late claim. Union is idempotent, so
// older grants kept in the stale value are unaffected.
const grantedClaims = new Set<string>();

// Persists an intended envelope merged with the in-process grant set, so a
// slow writer cannot erase claims granted after its value was computed.
// Only granted claims are merged: a read can observe a not-yet-removed
// phantom, and merging observed-but-ungranted entries would resurrect it.
// Grants imply emission happened, so they must persist unconditionally.
function persistClaims(intended: string[]): Promise<void> {
  const merged = new Set(intended);
  for (const granted of grantedClaims) {
    merged.add(granted);
  }
  return AsyncStorage.setItem(
    CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY,
    serializeTrackedOrderIds([...merged])
  );
}

let claimChain: Promise<void> = Promise.resolve();

const CLAIM_STORAGE_TIMEOUT_MS = 3000;
// Upper bound on how long one claim can hold the queue while its storage
// settles. Past this point the queue is released so later claims still get
// their turn; a write that lands afterwards is still compensated by the
// rollback attached to the raw write promise.
const MAX_QUEUE_HOLD_MS = 10_000;
const STORAGE_TIMEOUT = Symbol('claim-storage-timeout');

function storageTimeout(): Promise<typeof STORAGE_TIMEOUT> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(STORAGE_TIMEOUT), CLAIM_STORAGE_TIMEOUT_MS);
  });
}

async function readStoredClaims(): Promise<string[] | typeof STORAGE_TIMEOUT> {
  const raw = await Promise.race([
    AsyncStorage.getItem(CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY),
    storageTimeout(),
  ]);
  if (raw === STORAGE_TIMEOUT) {
    return STORAGE_TIMEOUT;
  }
  return parseTrackedOrderIds(raw);
}

// Merges the in-process grant set over a stored claim list, optionally
// dropping one phantom late claim. Returns null when there is nothing to
// repair so callers never rewrite a healthy store.
function computeReconciledClaims(
  stored: string[],
  removeClaim?: string
): string[] | null {
  const reconciled = new Set(
    removeClaim === undefined
      ? stored
      : stored.filter((entry) => entry !== removeClaim)
  );
  for (const granted of grantedClaims) {
    reconciled.add(granted);
  }
  if (
    reconciled.size === stored.length &&
    stored.every((entry) => reconciled.has(entry))
  ) {
    return null;
  }
  return [...reconciled];
}

// A write that lands after its caller already timed out must not leave a
// phantom claim: the caller suppressed the analytics event, so a replay
// would see the persisted claim and skip the event forever. Remove exactly
// the late claim (best effort, bounded waits, failures logged) — but the
// stale write also overwrites the envelope, erasing claims granted after
// the queue was released. Reconcile those back from the in-process grant
// set, or the erased events would emit again on replay.
async function removeClaimAfterLateWrite(claim: string): Promise<void> {
  try {
    const stored = await readStoredClaims();
    if (stored === STORAGE_TIMEOUT) {
      return;
    }
    const reconciled = computeReconciledClaims(stored, claim);
    // Nothing to repair: the late claim never landed and no newer grants
    // exist. Skip the write so a healthy store is never rewritten here.
    if (reconciled === null) {
      return;
    }
    // Unioned at call time with the best-known set, so grants committed
    // after this value was computed still survive its landing.
    const rollbackWrite = persistClaims(reconciled);
    const written = await Promise.race([
      rollbackWrite.then(() => true as const),
      storageTimeout(),
    ]);
    if (written === STORAGE_TIMEOUT) {
      log.error('Checkout purchase tracking claim rollback timed out.');
    }
    // The rollback value was computed before it landed: a newer grant
    // committed in between is erased however promptly the write settles,
    // not only when it misses its own timeout — so reconcile on every
    // settlement, not just the timeout branch. reconcileStoredClaims is a
    // read plus a conditional write (skipped when the store is healthy),
    // and union is idempotent, so the extra pass is safe. No further
    // compensation — the residual needs consecutive stalls at every
    // level to matter.
    void rollbackWrite.then(
      () => reconcileStoredClaims().catch(() => undefined),
      () => undefined
    );
  } catch (error) {
    log.error('Failed to roll back late checkout purchase claim:', error);
  }
}

// Merges the in-process grant set over the current store. Used both by the
// late-write rollback (which additionally drops one phantom claim) and as
// the compensation when a rollback write itself lands late.
async function reconcileStoredClaims(): Promise<void> {
  try {
    const stored = await readStoredClaims();
    if (stored === STORAGE_TIMEOUT) {
      return;
    }
    const reconciled = computeReconciledClaims(stored);
    if (reconciled === null) {
      return;
    }
    await Promise.race([persistClaims(reconciled), storageTimeout()]);
  } catch (error) {
    log.error('Failed to reconcile checkout purchase claims:', error);
  }
}

/**
 * Releases a previously granted claim so a later poll or revisit can emit
 * the event again. Used when the guarded emission fails after the claim
 * was granted (e.g. the ad-platform purchase rejects): without the
 * release, the persisted claim would suppress the conversion forever.
 * Best-effort and never-rejecting, like the claim itself.
 */
export function releaseCheckoutPurchaseTracking(
  orderId: string,
  eventName = 'purchase'
): Promise<void> {
  const run = claimChain.then(() => performRelease(orderId, eventName));
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
  return run.then(
    () => undefined,
    () => undefined
  );
}

async function performRelease(
  orderId: string,
  eventName: string
): Promise<{ settled: Promise<void> }> {
  const settled = Promise.resolve();
  if (!orderId) {
    return { settled };
  }
  const claim = eventName === 'purchase' ? orderId : `${eventName}:${orderId}`;
  // Drop from the in-process grant set BEFORE persisting: persistClaims
  // re-merges every grant, so releasing after the write would resurrect
  // the claim (and its reconciliations) instead of freeing it.
  grantedClaims.delete(claim);
  try {
    const stored = await readStoredClaims();
    if (stored === STORAGE_TIMEOUT) {
      log.error('Checkout purchase tracking store read timed out.');
      return { settled };
    }
    if (!stored.includes(claim)) {
      return { settled };
    }
    const write = persistClaims(stored.filter((entry) => entry !== claim));
    const written = await Promise.race([
      write.then(() => true as const),
      storageTimeout(),
    ]);
    if (written === STORAGE_TIMEOUT) {
      log.error('Checkout purchase tracking claim release timed out.');
      return {
        settled: write.then(
          () => reconcileStoredClaims().catch(() => undefined),
          () => undefined
        ),
      };
    }
    return { settled };
  } catch (error) {
    log.error('Failed to release checkout purchase tracking claim:', error);
    return { settled };
  }
}

export function claimCheckoutPurchaseTracking(
  orderId: string,
  eventName = 'purchase'
): Promise<boolean> {
  const run = claimChain.then(() => performClaim(orderId, eventName));
  // performClaim never rejects, so the chain always advances; it advances
  // on storage settlement so a started-but-timed-out write cannot clobber
  // the next claim — but never longer than the maximum hold, or a write
  // that never settles would wedge every later claim behind it.
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
  return run.then(
    ({ claimed }) => claimed,
    () => false
  );
}

async function performClaim(
  orderId: string,
  eventName: string
): Promise<{ claimed: boolean; settled: Promise<void> }> {
  const settled = Promise.resolve();
  if (!orderId) {
    return { claimed: false, settled };
  }
  try {
    // A wedged native store must not stall the checkout flow: bound every
    // storage operation and treat a timeout as unavailable (skip the
    // emission, let navigation proceed) rather than queueing forever.
    const stored = await readStoredClaims();
    if (stored === STORAGE_TIMEOUT) {
      log.error('Checkout purchase tracking store read timed out.');
      return { claimed: false, settled };
    }
    const claim =
      eventName === 'purchase' ? orderId : `${eventName}:${orderId}`;
    if (stored.includes(claim)) {
      return { claimed: false, settled };
    }
    const write = persistClaims([...stored, claim]);
    const written = await Promise.race([
      write.then(() => true as const),
      storageTimeout(),
    ]);
    if (written === STORAGE_TIMEOUT) {
      // The caller gets its answer now, but the queue stays serialized
      // until this write settles, and a late success is compensated so no
      // phantom claim suppresses the replay.
      log.error('Checkout purchase tracking store write timed out.');
      return {
        claimed: false,
        settled: write.then(
          () => removeClaimAfterLateWrite(claim),
          () => undefined
        ),
      };
    }
    grantedClaims.add(claim);
    return { claimed: true, settled };
  } catch (error) {
    log.error('Failed to persist checkout purchase tracking claims:', error);
    return { claimed: false, settled };
  }
}
