import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  getPiggyvestPrimaryCapability,
  usePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability';
import {
  getCapabilityCacheVersion,
  msUntilNegativeCapabilityExpires,
  subscribeCapabilityCache,
} from '@/lib/piggyvest-primary-capability-cache';
import { readPiggyvestCapabilityNow } from '@/lib/read-piggyvest-capability-now';

// The extra arguments are render keys: React Compiler memoizes plain calls
// by their arguments, so passing the hook verdict and the expiry tick makes
// the cache read recompute whenever either changes.
function verdictFor(
  merchantId: string | null | undefined,
  _capability: boolean | null,
  _tick: number
): boolean | null {
  return readPiggyvestCapabilityNow(merchantId);
}

function msLeftFor(
  merchantId: string | null | undefined,
  _capability: boolean | null,
  _tick: number
): number | null {
  return merchantId ? msUntilNegativeCapabilityExpires(merchantId) : null;
}

/**
 * The merchant's current PiggyVest verdict for render-time decisions: true,
 * false (ruled out, still current) or null (unknown or expired). Re-renders
 * when the capability hook answers and exactly when a cached ruling-out
 * expires (Codex), so screens never act on a stale "ruled out".
 */
export function usePiggyvestCapabilityNow(
  merchantId: string | null | undefined
): boolean | null {
  const capability = usePiggyvestPrimaryCapability(merchantId);
  const [expiryTick, setTick] = useState(0);
  // Any cache write (a probe, a rollback to "not ready") re-renders here.
  const cacheVersion = useSyncExternalStore(
    subscribeCapabilityCache,
    getCapabilityCacheVersion
  );
  const tick = expiryTick + cacheVersion;
  const remaining = msLeftFor(merchantId, capability, tick);
  useEffect(() => {
    if (remaining === null) return;
    const timer = setTimeout(() => {
      setTick((value) => value + 1);
      // Ask again at the boundary (Codex): after a rollback the nested
      // hook still holds its old verdict and schedules no re-probe of its
      // own, so the verdict would otherwise stay unknown until remount.
      if (merchantId) {
        void getPiggyvestPrimaryCapability(merchantId).catch(() => undefined);
      }
    }, remaining + 1);
    return () => clearTimeout(timer);
  }, [merchantId, remaining]);
  return verdictFor(merchantId, capability, tick);
}
