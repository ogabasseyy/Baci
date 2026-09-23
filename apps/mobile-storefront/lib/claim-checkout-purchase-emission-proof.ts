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
