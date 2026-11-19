import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { getOxygenStagingProfile } from '@/lib/oxygen-staging-profile';
import { oxygenNativeSession } from '@/services/oxygen/native-session';
import { useAuthStore } from '@/stores/auth-store';
import type { CartItem } from '@/stores/cart-store';
import { cartHasVoucherLine } from './checkout-prize-cart-guard';

const unavailable =
  'Oxygen staging setup is unavailable. Check your staging account and connection.';

export function useOxygenCheckoutAvailability(items: CartItem[]) {
  const userId = useAuthStore((state) => state.user?.id);
  const customerId = useAuthStore((state) => state.customer?.id);
  const customerUserId = useAuthStore((state) => state.customer?.user_id);
  const customerMerchantId = useAuthStore(
    (state) => state.customer?.merchant_id
  );
  const merchantId = useAuthStore((state) => state.merchantId);
  const profile = getOxygenStagingProfile();
  const linked =
    Boolean(userId && customerId) &&
    customerUserId === userId &&
    customerMerchantId === profile?.merchantId;
  const hasVoucher = cartHasVoucherLine(items);
  const scope =
    profile && linked && !hasVoucher
      ? JSON.stringify([
          userId,
          customerId,
          merchantId,
          profile.merchantId,
          profile.merchantSlug,
          profile.apiOrigin,
          profile.authBaseUrl,
        ])
      : null;
  const [readiness, setReadiness] = useState<{
    scope: string;
    reason: string | undefined;
  } | null>(null);

  useEffect(() => {
    setReadiness(null);
    if (!scope) return;
    let probe = 0;
    let wasOnline: boolean | undefined;
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online =
        state.isConnected !== false && state.isInternetReachable !== false;
      if (online === wasOnline) return;
      wasOnline = online;
      const currentProbe = ++probe;
      if (!online) {
        setReadiness({ scope, reason: unavailable });
        return;
      }
      setReadiness(null);
      void Promise.resolve()
        .then(() => oxygenNativeSession().capabilities(true))
        .then(
          () => {
            if (currentProbe === probe)
              setReadiness({ scope, reason: undefined });
          },
          () => {
            if (currentProbe === probe)
              setReadiness({ scope, reason: unavailable });
          }
        );
    });
    return () => {
      ++probe;
      unsubscribe();
    };
  }, [scope]);

  if (!profile) return { visible: false, disabledReason: undefined };
  const disabledReason = !linked
    ? 'Sign in with your linked staging customer account'
    : hasVoucher
      ? 'Oxygen is unavailable for voucher carts'
      : readiness?.scope !== scope
        ? 'Checking Oxygen staging availability'
        : readiness.reason;
  return { visible: true, disabledReason };
}
