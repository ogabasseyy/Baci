import { useEffect, useEffectEvent, useState } from 'react';
import { buildVtuPurchaseDescriptor } from '@/lib/pending-vtu-descriptor';
import type { VtuWalletPayRequest } from '@/lib/wallet-pay/vtu-wallet-pay-api';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

/**
 * Whether an earlier PiggyVest attempt for this exact purchase is kept (its
 * answer was lost): the next submit replays it on PiggyVest whatever the
 * balances say, so the payment section shows PiggyVest too (Codex P2). A key
 * store that can not be read counts as kept, as the submit treats it.
 */
export function useRetainsPiggyvest(request: VtuWalletPayRequest | null) {
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
  return answer !== null && answer.key === key && answer.kept;
}
