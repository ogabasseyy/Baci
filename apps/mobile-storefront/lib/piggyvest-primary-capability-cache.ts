/**
 * Shared verdict cache for the PiggyVest primary capability probe.
 *
 * Extracted so the synchronous merchant gate can observe a server-confirmed
 * verdict without importing the async probe (which would create a module
 * cycle). Only a positively observed `true` expands primary routing; every
 * other state fails closed to the pilot allowlist.
 */
const CAPABILITY_TTL_MS = 60_000;
const capabilityCache = new Map<
  string,
  { available: boolean; observedAt: number }
>();

export function readObservedPiggyvestPrimaryCapability(
  merchantId: string
): boolean | null {
  const cached = capabilityCache.get(merchantId);
  if (!cached || Date.now() - cached.observedAt >= CAPABILITY_TTL_MS)
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
