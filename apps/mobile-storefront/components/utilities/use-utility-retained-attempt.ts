import { useEffect, useEffectEvent, useState } from 'react';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import { buildVtuPurchaseDescriptor } from '@/lib/pending-vtu-descriptor';
import type { VtuWalletPayRequest } from '@/lib/wallet-pay/vtu-wallet-pay-api';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

/** One form's answer to "is an earlier attempt for this purchase kept?". */
export interface UtilityRetainedAttempt {
  /** The PiggyVest lookup has not answered for this purchase yet. */
  lookupPending: boolean;
  /** A PiggyVest attempt is kept (answered; a failed read counts as kept). */
  retainedPiggyvest: boolean;
  /** A store credit attempt is kept. */
  retainedStoreCredit: boolean;
}

/**
 * Whether Pay must stay pressable whatever the balance says: a kept attempt
 * replays without a new charge, and a lookup still in flight is not yet a
 * "no" (the submit makes the real decision).
 */
export function isRetainedForPay(attempt: UtilityRetainedAttempt): boolean {
  return (
    attempt.retainedStoreCredit ||
    attempt.retainedPiggyvest ||
    attempt.lookupPending
  );
}

/**
 * The single kept-attempt lookup a utility form runs for its current
 * purchase. The payment section (which rail is shown) and the Pay gate
 * (whether a short balance blocks) both read this one answer, so they can
 * never disagree and the PiggyVest key store is read once per change.
 */
export function useUtilityRetainedAttempt(
  payment: Pick<ReturnType<typeof useUtilityPayment>, 'hasRetainedVtuAttempt'>,
  request: VtuWalletPayRequest | null
): UtilityRetainedAttempt {
  const retains = useVtuWalletPayStore((state) => state.retains);
  const key = request ? buildVtuPurchaseDescriptor({ ...request }) : null;
  const [answer, setAnswer] = useState<{ key: string; kept: boolean } | null>(
    null
  );
  const current = useEffectEvent(() => request);
  useEffect(() => {
    const next = current();
    if (key === null || next === null) return;
    let live = true;
    retains(next).then(
      (kept) => live && setAnswer({ key, kept }),
      () => live && setAnswer({ key, kept: true })
    );
    return () => {
      live = false;
    };
  }, [key, retains]);

  if (request === null) {
    return {
      lookupPending: false,
      retainedPiggyvest: false,
      retainedStoreCredit: false,
    };
  }
  const answered = answer !== null && answer.key === key;
  return {
    lookupPending: !answered,
    retainedPiggyvest: answered && answer.kept,
    retainedStoreCredit:
      payment.hasRetainedVtuAttempt?.({ ...request }) === true,
  };
}
