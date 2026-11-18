import { useEffect, useState } from 'react';
import { getOxygenStagingProfile } from '@/lib/oxygen-staging-profile';
import { oxygenNativeSession } from '@/services/oxygen/native-session';
import { useAuthStore } from '@/stores/auth-store';
import type { CartItem } from '@/stores/cart-store';
import { cartHasVoucherLine } from './checkout-prize-cart-guard';
export function useOxygenCheckoutAvailability(items: CartItem[]) {
  const userId = useAuthStore((state) => state.user?.id);
  const customer = useAuthStore((state) => state.customer);
  const merchantId = useAuthStore((state) => state.merchantId);
  const profile = getOxygenStagingProfile();
  const [readiness, setReadiness] = useState<{
    scope: string;
    reason: string | undefined;
  } | null>(null);
  const scope = `${userId}:${customer?.id}:${customer?.user_id}:${merchantId}`;
  useEffect(() => {
    if (!profile || !userId || !customer) return;
    let live = true;
    void Promise.resolve()
      .then(() => oxygenNativeSession().capabilities(true))
      .then(
        () => {
          if (live) setReadiness({ scope, reason: undefined });
        },
        () => {
          if (live)
            setReadiness({
              scope,
              reason:
                'Oxygen staging setup is unavailable. Check your staging account and connection.',
            });
        }
      );
    return () => {
      live = false;
    };
  }, [profile, userId, customer, scope]);
  if (!profile) return { visible: false, disabledReason: undefined };
  const disabledReason =
    !userId || !customer
      ? 'Sign in with your linked staging customer account'
      : cartHasVoucherLine(items)
        ? 'Oxygen is unavailable for voucher carts'
        : readiness?.scope !== scope
          ? 'Checking Oxygen staging availability'
          : readiness.reason;
  return { visible: true, disabledReason };
}
