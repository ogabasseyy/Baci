/**
 * Shared verdict cache for the PiggyVest primary capability probe.
 *
 * Extracted so the synchronous merchant gate can observe a server-confirmed
 * verdict without importing the async probe (which would create a module
 * cycle). Only a positively observed `true` expands primary routing; every
 * other state fails closed to the pilot allowlist.
 *
 * A positive verdict is retained until the cache is explicitly cleared,
 * an authoritative NOT_READY rolls it back (see
 * rollbackObservedCapabilityOnNotReady), or the app restarts (verdicts
 * are merchant-scoped, so account switches do not invalidate them):
 * expiring it would silently reroute the next financial action through
 * legacy while the UI still promises primary. That direction is
 * fail-safe — a stale `true` produces one server 503, and every mutation
 * path falls back to the working legacy flow on NOT_READY. A negative
 * verdict expires after 60s so newly-ready merchants are picked up.
 */
export const NEGATIVE_CAPABILITY_TTL_MS = 60_000;
const capabilityCache = new Map<
  string,
  { available: boolean; observedAt: number }
>();

export function readObservedPiggyvestPrimaryCapability(
  merchantId: string
): boolean | null {
  const cached = capabilityCache.get(merchantId);
  if (!cached) return null;
  if (
    !cached.available &&
    Date.now() - cached.observedAt >= NEGATIVE_CAPABILITY_TTL_MS
  )
    return null;
  return cached.available;
}

export function observePiggyvestPrimaryCapability(
  merchantId: string,
  available: boolean
) {
  capabilityCache.set(merchantId, { available, observedAt: Date.now() });
}

export function clearObservedPiggyvestPrimaryCapability() {
  capabilityCache.clear();
}
