import {
  claimKey,
  deleteGrantedClaim,
  grantedClaimSnapshot,
  log,
  persistClaims,
  readStoredClaims,
  STORAGE_TIMEOUT,
  serializeClaimTask,
  storageTimeout,
} from './claim-store-core';

// Merges the in-process grant set over a stored claim list, optionally
// dropping one phantom late claim. Returns null when there is nothing to
// repair so callers never rewrite a healthy store.
export function computeReconciledClaims(
  stored: string[],
  removeClaim?: string
): string[] | null {
  const reconciled = new Set(
    removeClaim === undefined
      ? stored
      : stored.filter((entry) => entry !== removeClaim)
  );
  for (const granted of grantedClaimSnapshot()) {
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

// Merges the in-process grant set over the current store. Used both by the
// late-write rollback (which additionally drops one phantom claim) and as
// the compensation when a rollback or release-retry write itself lands
// late.
export async function reconcileStoredClaims(): Promise<void> {
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

// Bounded passes over a release that missed its own storage budget. A
// release whose read times out returns while the persisted claim remains;
// without a retry, the next settlement poll reads that stale claim,
// classifies it as already-emitted, and stops permanently even though the
// failed conversion was never emitted. Each pass is enqueued (never
// inline) so its read-modify-write serializes behind every other claim
// task, and each pass fully settles before the queue advances.
const RELEASE_RETRY_ATTEMPTS = 3;

function scheduleReleaseRetry(claim: string, attemptsLeft: number): void {
  if (attemptsLeft <= 0) {
    log.error(
      'Checkout purchase tracking claim release retries exhausted:',
      claim
    );
    return;
  }
  void serializeClaimTask(async () => {
    const settled = Promise.resolve();
    try {
      const stored = await readStoredClaims();
      if (stored === STORAGE_TIMEOUT) {
        log.error('Checkout purchase tracking claim release retry timed out.');
        scheduleReleaseRetry(claim, attemptsLeft - 1);
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
        log.error('Checkout purchase tracking claim release retry timed out.');
        // The retry write may still land late: reconcile the grant set
        // over it so it cannot erase newer grants, and pass again in
        // case it never lands.
        void write.then(
          () => reconcileStoredClaims().catch(() => undefined),
          () => undefined
        );
        scheduleReleaseRetry(claim, attemptsLeft - 1);
      }
    } catch (error) {
      log.error(
        'Checkout purchase tracking claim release retry failed:',
        error
      );
      scheduleReleaseRetry(claim, attemptsLeft - 1);
    }
    return { settled };
  }).then(
    () => undefined,
    () => undefined
  );
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
  // performRelease never rejects, so the chain always advances.
  return serializeClaimTask(() => performRelease(orderId, eventName)).then(
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
  const claim = claimKey(orderId, eventName);
  // Drop from the in-process grant set BEFORE persisting: persistClaims
  // re-merges every grant, so releasing after the write would resurrect
  // the claim (and its reconciliations) instead of freeing it.
  deleteGrantedClaim(claim);
  try {
    const stored = await readStoredClaims();
    if (stored === STORAGE_TIMEOUT) {
      log.error('Checkout purchase tracking store read timed out.');
      // The persisted claim remains: retry on a bounded schedule or the
      // next poll mistakes it for a recorded conversion and stops.
      scheduleReleaseRetry(claim, RELEASE_RETRY_ATTEMPTS);
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
      // The write may still land (handled by the attached
      // reconciliation) or never land (handled by the retry): cover both.
      scheduleReleaseRetry(claim, RELEASE_RETRY_ATTEMPTS);
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
    // A rejected read leaves the persisted claim exactly as a timed-out
    // read does: retry on the same bounded schedule or the next poll
    // mistakes it for a recorded conversion and stops.
    scheduleReleaseRetry(claim, RELEASE_RETRY_ATTEMPTS);
    return { settled };
  }
}
