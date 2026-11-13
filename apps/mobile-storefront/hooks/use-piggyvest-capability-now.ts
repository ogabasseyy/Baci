import { useEffect, useState } from 'react';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import { msUntilNegativeCapabilityExpires } from '@/lib/piggyvest-primary-capability-cache';
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
  const [tick, setTick] = useState(0);
  const remaining = msLeftFor(merchantId, capability, tick);
  useEffect(() => {
    if (remaining === null) return;
    const timer = setTimeout(
      () => setTick((value) => value + 1),
      remaining + 1
    );
    return () => clearTimeout(timer);
  }, [remaining]);
  return verdictFor(merchantId, capability, tick);
}
