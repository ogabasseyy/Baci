import { useEffect, useEffectEvent, useState } from 'react';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import { buildVtuPurchaseDescriptor } from '@/lib/pending-vtu-descriptor';
import type { VtuWalletPayRequest } from '@/lib/wallet-pay/vtu-wallet-pay-api';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

/**
 * Whether this exact purchase may have a kept attempt (store credit or
 * PiggyVest) whose answer was lost. The next submit replays it without a new
 * charge, so a short balance must not block Pay for it.
 *
 * The PiggyVest lookup is asynchronous. Until it answers for this purchase it
 * counts as kept, so Pay is never disabled by a lookup still in flight (the
 * submit makes the real decision); a failed lookup counts as kept, as the
 * submit treats it.
 */
export function useUtilityRetainedAttempt(
  payment: Pick<ReturnType<typeof useUtilityPayment>, 'hasRetainedVtuAttempt'>,
  request: VtuWalletPayRequest | null
): boolean {
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

  if (request === null) return false;
  if (payment.hasRetainedVtuAttempt?.({ ...request }) === true) return true;
  // Not answered for this purchase yet: never treat as short meanwhile.
  return answer === null || answer.key !== key || answer.kept;
}
