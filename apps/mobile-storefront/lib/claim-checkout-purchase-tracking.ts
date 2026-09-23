import {
  computeReconciledClaims,
  reconcileStoredClaims,
} from './claim-checkout-purchase-release';
import {
  addGrantedClaim,
  claimKey,
  isClaimGranted,
  isOrphanedClaimLease,
  log,
  MAX_QUEUE_HOLD_MS,
  persistClaimEnvelope,
  readClaimEnvelope,
  STORAGE_TIMEOUT,
  serializeClaimTask,
  storageTimeout,
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

function trackCompensation(claim: string, compensation: Promise<void>): void {
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

/**
 * Records emission proof for a granted claim. The once-helper calls this
 * after dispatching the conversion: a later restart then reads the claim
 * as recorded at any age instead of orphaning it for recovery (which
 * would double-emit). Bounded and never-rejecting like every claim
 * operation.
 */
export function markCheckoutPurchaseEmitted(
  orderId: string,
  eventName = 'purchase'
): Promise<void> {
  if (!orderId) {
    return Promise.resolve();
  }
  const claim = claimKey(orderId, eventName);
  return serializeClaimTask(async () => {
    const settled = Promise.resolve();
    try {
      // Read-modify-write inside the serialized task so the stamp cannot
      // interleave with a concurrent grant or rollback and lose either.
      const envelope = await readClaimEnvelope();
      if (envelope === STORAGE_TIMEOUT) {
        log.error('Failed to mark checkout purchase emitted: store timeout.');
        return { settled };
      }
      const now = Date.now();
      await Promise.race([
        persistClaimEnvelope({
          claims: envelope.claims,
          leases: {
            ...envelope.leases,
            [claim]: {
              claimedAt: envelope.leases[claim]?.claimedAt ?? now,
              emittedAt: now,
            },
          },
        }),
        storageTimeout(),
      ]);
    } catch (error) {
      log.error('Failed to mark checkout purchase emitted:', error);
    }
    return { settled };
  }).then(
    () => undefined,
    () => undefined
  );
}

export function claimCheckoutPurchaseTracking(
  orderId: string,
  eventName = 'purchase'
): Promise<boolean> {
  // performClaim never rejects, so the chain always advances.
  return serializeClaimTask(() => performClaim(orderId, eventName)).then(
    ({ claimed }) => claimed,
    () => false
  );
}

export type CreationPurchaseOutcome = 'sent' | 'failed';

// In-flight creation-lane ad purchase emissions by order. The bare claim
// reads "held" from the instant it is granted, but the fire-and-forget
// creation emission may still be running: a settlement that lands in
// that window must await the shared emission instead of trusting the
// claim, or a later rejection loses the purchase while the funnel event
// it already emitted stands. Entries self-remove on settle; a missing
// entry means no emission is running and callers fall back to the claim.
const creationPurchaseInflight = new Map<
  string,
  Promise<CreationPurchaseOutcome>
>();

export function trackCreationPurchaseEmission(
  orderId: string,
  emission: Promise<unknown>
): void {
  if (!orderId) {
    return;
  }
  const outcome = emission.then(
    (): CreationPurchaseOutcome => 'sent',
    (): CreationPurchaseOutcome => 'failed'
  );
  creationPurchaseInflight.set(orderId, outcome);
  void outcome.finally(() => {
    if (creationPurchaseInflight.get(orderId) === outcome) {
      creationPurchaseInflight.delete(orderId);
    }
  });
}

/**
 * Shares the running creation emission, if any. Resolves 'sent' once the
 * ad purchase went out, 'failed' once it rejected (the lane's catch
 * releases the bare claim then), or null when no emission is running —
 * in which case the durable claim is the source of truth. Never rejects.
 */
export async function awaitCreationPurchaseEmission(
  orderId: string
): Promise<CreationPurchaseOutcome | null> {
  const inflight = creationPurchaseInflight.get(orderId);
  if (!inflight) {
    return null;
  }
  return await inflight;
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
    // emission, let navigation proceed) rather than queueing forever. The
    // grant and its lease persist in one envelope write, so a crash can
    // never leave a claim without its lease (or vice versa); the whole
    // read-modify-write runs inside this serialized task.
    const envelope = await readClaimEnvelope();
    if (envelope === STORAGE_TIMEOUT) {
      log.error('Checkout purchase tracking store read timed out.');
      return { claimed: false, settled };
    }
    const claim = claimKey(orderId, eventName);
    let base = envelope.claims;
    let leases = envelope.leases;
    if (envelope.claims.includes(claim)) {
      // A denied claim is usually a recorded conversion — except when its
      // lease proves it orphaned (granted, never emitted, already aged):
      // drop it here and fall through to grant anew so the paid order's
      // conversion is still recorded instead of blocked forever.
      if (!isOrphanedClaimLease(leases[claim])) {
        return { claimed: false, settled };
      }
      log.error('Checkout purchase tracking claim orphaned; recovering:', {
        claim,
      });
      base = envelope.claims.filter((entry) => entry !== claim);
      const { [claim]: _orphaned, ...surviving } = leases;
      leases = surviving;
    }
    const write = persistClaimEnvelope({
      claims: [...base, claim],
      // The lease bounds crash recovery: without it a restart between
      // grant and dispatch leaves a claim no later poll can distinguish
      // from a recorded conversion.
      leases: { ...leases, [claim]: { claimedAt: Date.now() } },
    });
    const written = await Promise.race([
      write.then(() => true as const),
      storageTimeout(),
    ]);
    if (written === STORAGE_TIMEOUT) {
      // The caller gets its answer now, but the queue stays serialized
      // until this write settles, and a late success is compensated so no
      // phantom claim suppresses the replay.
      log.error('Checkout purchase tracking store write timed out.');
      const compensation = write.then(
        () => removeClaimAfterLateWrite(claim),
        () => undefined
      );
      trackCompensation(claim, compensation);
      return { claimed: false, settled: compensation };
    }
    addGrantedClaim(claim);
    return { claimed: true, settled };
  } catch (error) {
    log.error('Failed to persist checkout purchase tracking claims:', error);
    return { claimed: false, settled };
  }
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
    const envelope = await readClaimEnvelope();
    if (envelope === STORAGE_TIMEOUT) {
      return;
    }
    const reconciled = computeReconciledClaims(envelope.claims, claim);
    // Nothing to repair: the late claim never landed and no newer grants
    // exist. Skip the write so a healthy store is never rewritten here.
    if (reconciled === null) {
      return;
    }
    // Leases pass through from the fresh read, and persistClaimEnvelope
    // additionally repairs any lease a stale snapshot clobbered for a
    // still-granted claim — so this rollback cannot resurrect an orphan.
    // Unioned at call time with the best-known set, so grants committed
    // after this value was computed still survive its landing.
    const rollbackWrite = persistClaimEnvelope({
      claims: reconciled,
      leases: envelope.leases,
    });
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
    //
    // Awaited, not detached: the claim chain advances on this
    // compensation's settlement, so denied-claim disambiguation reads
    // enqueued behind it observe post-rollback state instead of the
    // phantom. A write that never settles still releases the queue via
    // MAX_QUEUE_HOLD, and reconcileStoredClaims never rejects.
    await rollbackWrite.then(
      () => reconcileStoredClaims().catch(() => undefined),
      () => undefined
    );
  } catch (error) {
    log.error('Failed to roll back late checkout purchase claim:', error);
  }
}
