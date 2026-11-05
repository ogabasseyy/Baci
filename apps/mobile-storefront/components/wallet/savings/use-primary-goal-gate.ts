import { useEffect, useState } from 'react';
import { CONFIG } from '@/lib/config';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { useAuthStore } from '@/stores/auth-store';

export type PrimaryGoalGate = 'checking' | 'ready' | 'off';

/**
 * Whether the goal lifecycle (cancel / complete) may be shown: only on an
 * explicit server verdict that this customer's main wallet is ready, on a
 * PiggyVest merchant. Anything else (pending, no account, a not-ready or any
 * other failure, another merchant) is 'off' and the screens stay as they
 * were. The answer is pinned to the signed-in user: one that arrives after an
 * account or merchant switch is dropped.
 */
export function usePrimaryGoalGate(): PrimaryGoalGate {
  const userId = useAuthStore((state) => state.user?.id);
  const storeMerchantId = useAuthStore((state) => state.merchantId);
  const merchantId = pickMerchantId(storeMerchantId, CONFIG.MERCHANT_ID);
  const eligible = Boolean(
    userId && merchantId && isPiggyvestPrimaryMerchant(merchantId)
  );
  const scope = eligible ? `${userId}:${merchantId}` : null;
  const [answer, setAnswer] = useState<{
    scope: string;
    ready: boolean;
  } | null>(null);

  useEffect(() => {
    if (!scope || !userId || !merchantId) return;
    let current = true;
    piggyvestPrimaryWalletApi
      .read(merchantId, userId)
      .then((snapshot) => {
        if (current)
          setAnswer({
            scope,
            ready:
              snapshot.provisioningStatus === 'ready' &&
              snapshot.account !== null,
          });
      })
      .catch(() => {
        if (current) setAnswer({ scope, ready: false });
      });
    return () => {
      current = false;
    };
  }, [scope, userId, merchantId]);

  if (!scope) return 'off';
  if (answer?.scope !== scope) return 'checking';
  return answer.ready ? 'ready' : 'off';
}
