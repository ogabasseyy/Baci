import { trackCompensation } from './claim-checkout-purchase-reads';
import { reconcileStoredClaims } from './claim-checkout-purchase-release';
import {
  claimKey,
  log,
  persistClaimEnvelope,
  readClaimEnvelope,
  STORAGE_TIMEOUT,
  serializeClaimTask,
  storageTimeout,
} from './claim-store-core';

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
      const write = persistClaimEnvelope({
        claims: envelope.claims,
        leases: {
          ...envelope.leases,
          [claim]: {
            claimedAt: envelope.leases[claim]?.claimedAt ?? now,
            emittedAt: now,
          },
        },
      });
      const written = await Promise.race([
        write.then(() => true as const),
        storageTimeout(),
      ]);
      if (written === STORAGE_TIMEOUT) {
        // The caller returns now, but the queue stays serialized until
        // this write settles, and a late landing is compensated like the
        // grant path: the stale snapshot can erase newer claims/leases,
        // so reconcileStoredClaims unions the in-process grant set back.
        log.error(
          'Failed to mark checkout purchase emitted: store write timed out.'
        );
        const compensation = write.then(
          () => reconcileStoredClaims().catch(() => undefined),
          () => undefined
        );
        trackCompensation(claim, compensation);
        return { settled: compensation };
      }
    } catch (error) {
      log.error('Failed to mark checkout purchase emitted:', error);
    }
    return { settled };
  }).then(
    () => undefined,
    () => undefined
  );
}
