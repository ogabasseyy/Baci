import {
  computeReconciledClaims,
  reconcileStoredClaims,
} from './claim-checkout-purchase-release';
import {
  addGrantedClaim,
  claimKey,
  isClaimGranted,
  log,
  persistClaims,
  readStoredClaims,
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
    const stored = await readStoredClaims();
    if (stored === STORAGE_TIMEOUT) {
      return false;
    }
    return stored.includes(claim);
  } catch (error) {
    log.error('Failed to read checkout purchase tracking claim:', error);
    return false;
  }
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
    // emission, let navigation proceed) rather than queueing forever.
    const stored = await readStoredClaims();
    if (stored === STORAGE_TIMEOUT) {
      log.error('Checkout purchase tracking store read timed out.');
      return { claimed: false, settled };
    }
    const claim = claimKey(orderId, eventName);
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
