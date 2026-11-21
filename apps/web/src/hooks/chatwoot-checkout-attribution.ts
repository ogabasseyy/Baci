const pinned = new Map<string, unknown>();
const MAX_PINNED = 20;

/**
 * Returns the ad-attribution snapshot first seen for a checkout request, so a
 * retry sends the same order body even if tracking cookies changed in between.
 * `/api/orders` treats the same Idempotency-Key with a different body as a
 * conflict, which would turn a harmless retry into a failure.
 */
export function pinChatwootCheckoutAttribution<T>(key: string, current: T): T {
  if (pinned.has(key)) return pinned.get(key) as T;
  pinned.set(key, current);
  if (pinned.size > MAX_PINNED) {
    const oldest = pinned.keys().next().value;
    if (oldest !== undefined) pinned.delete(oldest);
  }
  return current;
}

/** Test seam: forget pinned snapshots between cases. */
export function resetChatwootCheckoutAttribution() {
  pinned.clear();
}
