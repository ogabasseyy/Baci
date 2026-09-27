import {
  claimKey,
  isClaimGranted,
  isOrphanedClaimLease,
  log,
  MAX_QUEUE_HOLD_MS,
  readClaimEnvelope,
  STORAGE_TIMEOUT,
  serializeClaimTask,
} from './claim-store-core';

/**
 * Reports whether a conversion claim is currently held, either granted by
 * this process or persisted by an earlier session. Bounded and
 * never-rejecting like the claim itself; an unreadable store reports false
 * so callers favour retrying a paid order over assuming it was recorded.
 */
export async function isCheckoutPurchaseClaimed(
  orderId: string,
  eventName = 'purchase'
): Promise<boolean> {
  if (!orderId) {
    return false;
  }
  const claim = claimKey(orderId, eventName);
  if (isClaimGranted(claim)) {
    return true;
  }
  try {
    const envelope = await readClaimEnvelope();
    if (envelope === STORAGE_TIMEOUT) {
      return false;
    }
    if (!envelope.claims.includes(claim)) {
      return false;
    }
    // An aged claim with no emission proof is orphaned (the process died
    // between grant and dispatch): report unheld so a later poll recovers
    // it instead of assuming a conversion that never happened. Removal
    // happens on the next grant, inside the serialized claim task.
    return !isOrphanedClaimLease(envelope.leases[claim]);
  } catch (error) {
    log.error('Failed to read checkout purchase tracking claim:', error);
    return false;
  }
}

// Timed-out write compensations still in flight, by claim. The chain can
// release past them via MAX_QUEUE_HOLD while a rollback is still landing,
// so settled reads drain this claim's set explicitly instead of relying
// on chain position alone. Entries self-remove on settle.
const pendingCompensations = new Map<string, Set<Promise<void>>>();

export function trackCompensation(
  claim: string,
  compensation: Promise<void>
): void {
  let inflight = pendingCompensations.get(claim);
  if (!inflight) {
    inflight = new Set();
    pendingCompensations.set(claim, inflight);
  }
  inflight.add(compensation);
  const drop = () => {
    const remaining = pendingCompensations.get(claim);
    if (remaining) {
      remaining.delete(compensation);
      if (remaining.size === 0) {
        pendingCompensations.delete(claim);
      }
    }
  };
  compensation.then(drop, drop);
}

/**
 * Serialized variant of isCheckoutPurchaseClaimed for denied-claim
 * disambiguation. A raw read can catch a timed-out write's phantom
 * persisted claim before its rollback lands and mistake it for a recorded
 * conversion (stopping settlement retries, or clearing retained context,
 * although nothing was emitted). The read first drains this claim's
 * tracked compensations (the chain may have released past them via
 * MAX_QUEUE_HOLD), then runs through the claim chain, so the answer
 * reflects post-rollback state. A compensation that outlasts the queue
 * hold, like an unreadable store, reports unheld — favour retrying over
 * assuming recorded.
 */
export async function isCheckoutPurchaseClaimedSettled(
  orderId: string,
  eventName = 'purchase'
): Promise<boolean> {
  if (!orderId) {
    return false;
  }
  const claim = claimKey(orderId, eventName);
  if (isClaimGranted(claim)) {
    return true;
  }
  const pending = pendingCompensations.get(claim);
  if (pending && pending.size > 0) {
    const drained = await Promise.race([
      Promise.all([...pending]).then(() => true as const),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), MAX_QUEUE_HOLD_MS);
      }),
    ]);
    if (!drained) {
      return false;
    }
  }
  try {
    const observed = await serializeClaimTask(async () => {
      const settled = Promise.resolve();
      try {
        const envelope = await readClaimEnvelope();
        if (envelope === STORAGE_TIMEOUT) {
          return { held: false, settled };
        }
        if (!envelope.claims.includes(claim)) {
          return { held: false, settled };
        }
        return {
          held: !isOrphanedClaimLease(envelope.leases[claim]),
          settled,
        };
      } catch (error) {
        log.error('Failed to read checkout purchase tracking claim:', error);
        return { held: false, settled };
      }
    });
    return observed.held;
  } catch {
    return false;
  }
}
