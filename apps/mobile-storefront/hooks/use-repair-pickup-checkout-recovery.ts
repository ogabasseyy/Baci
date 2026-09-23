import { useEffect, useState } from 'react';
import type { RepairBookingRequest } from '@/lib/repair-catalog-schemas';
import { repairPickupSession } from '@/lib/repair-pickup-session';
import type { RepairPickupSession } from '@/schemas/repair-pickup';

export function useRepairPickupCheckoutRecovery(data: RepairBookingRequest) {
  const [saved, setSaved] = useState<RepairPickupSession | null>(null);
  const [ready, setReady] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit retries rerun failed secure-storage recovery.
  useEffect(() => {
    let active = true;
    repairPickupSession
      .load(data)
      .then((loaded) => {
        if (!active) return;
        setSaved(loaded);
        setReady(true);
      })
      .catch(() => {
        if (active) setRestoreFailed(true);
      });
    return () => {
      active = false;
    };
  }, [data, restoreAttempt]);

  // React Compiler owns memoization (AGENTS.md ADR-004): plain function.
  function retryRestore() {
    setRestoreFailed(false);
    setRestoreAttempt((value) => value + 1);
  }

  return { ready, restoreFailed, retryRestore, saved };
}
