import { useEffect, useRef, useState } from 'react';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import {
  rollbackObservedCapabilityOnNotReady,
  usePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability';
import { recoverPiggyvestPrimarySavings } from '@/lib/piggyvest-primary-savings-recovery';

export function usePrimarySavingsRecovery({
  merchantId,
  userId,
  goalId,
  operationRef,
  setAmount,
}: {
  merchantId?: string;
  userId?: string;
  goalId?: string;
  operationRef: { current: string | null };
  setAmount: (value: string) => void;
}) {
  const primaryCapability = usePiggyvestPrimaryCapability(merchantId);
  // An unknown verdict (null) enables the lookup but never readiness: a
  // rolled-out non-pilot merchant whose probe failed transiently reads
  // non-primary from the static allowlist, yet a primary transfer may
  // still be pending. Only an authoritative false skips the lookup and
  // releases legacy submissions.
  const verdictUnknown = primaryCapability === null;
  const enabled =
    primaryCapability !== false &&
    (isPiggyvestPrimaryMerchant(merchantId) || verdictUnknown) &&
    Boolean(userId && goalId);
  const key = JSON.stringify([merchantId, userId, goalId]);
  const boundKey = useRef<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({
    key: '',
    revision: -1,
    ready: false,
    error: false,
  });
  useEffect(() => {
    if (!enabled || !goalId) return;
    let active = true;
    if (boundKey.current !== key) {
      operationRef.current = null;
      boundKey.current = key;
    }
    setState({ key, revision, ready: false, error: false });
    void recoverPiggyvestPrimarySavings({ merchantId, goalId })
      .then((operation) => {
        if (!active) return;
        if (operation) {
          operationRef.current = operation.operationId;
          setAmount(String(operation.amountKobo / 100));
        }
        setState({ key, revision, ready: true, error: false });
      })
      .catch((error: unknown) => {
        if (!active) return;
        // Any lookup failure blocks: the pending endpoint consults
        // durable storage even when the runtime is disabled, so a throw
        // means the durable state is unknown — never "no operation".
        // Enabling submissions here would reroute a legacy contribution
        // alongside an already-submitted primary transfer. The rollback
        // still runs so an authoritative not-ready fails later gates
        // closed until the next successful probe.
        rollbackObservedCapabilityOnNotReady(merchantId, error);
        setState({ key, revision, ready: false, error: true });
      });
    return () => {
      active = false;
    };
  }, [enabled, goalId, key, merchantId, operationRef, revision, setAmount]);
  return {
    ready:
      !enabled ||
      (state.key === key &&
        state.revision === revision &&
        state.ready &&
        !verdictUnknown),
    error:
      enabled &&
      state.key === key &&
      state.revision === revision &&
      state.error,
    retry: () => setRevision((value) => value + 1),
  };
}
