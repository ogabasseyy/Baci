import { useEffect, useRef, useState } from 'react';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
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
  const enabled =
    isPiggyvestPrimaryMerchant(merchantId) && Boolean(userId && goalId);
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
      .catch(() => {
        if (active) setState({ key, revision, ready: false, error: true });
      });
    return () => {
      active = false;
    };
  }, [enabled, goalId, key, merchantId, operationRef, revision, setAmount]);
  return {
    ready:
      !enabled ||
      (state.key === key && state.revision === revision && state.ready),
    error:
      enabled &&
      state.key === key &&
      state.revision === revision &&
      state.error,
    retry: () => setRevision((value) => value + 1),
  };
}
