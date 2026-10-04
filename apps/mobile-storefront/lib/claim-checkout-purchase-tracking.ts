import { trackCompensation } from './claim-checkout-purchase-reads';
import {
  computeReconciledClaims,
  reconcileStoredClaims,
} from './claim-checkout-purchase-release';
import {
  addGrantedClaim,
  claimKey,
  isOrphanedClaimLease,
  log,
  persistClaimEnvelope,
  readClaimEnvelope,
  STORAGE_TIMEOUT,
  serializeClaimTask,
  storageTimeout,
} from './claim-store-core';

export type { CreationPurchaseOutcome } from './claim-checkout-creation-emission';
export {
  awaitCreationPurchaseEmission,
  trackCreationPurchaseEmission,
} from './claim-checkout-creation-emission';
export { markCheckoutPurchaseEmitted } from './claim-checkout-purchase-emission-proof';
// Focused claim modules live beside this grant core (300-line modularity
// limit); the public surface stays here so existing import sites keep
// their exact shape.
export {
  isCheckoutPurchaseClaimed,
  isCheckoutPurchaseClaimedSettled,
} from './claim-checkout-purchase-reads';

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
