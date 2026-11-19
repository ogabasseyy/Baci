import { withTimeout } from '@baci/shared';
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
    let delayedProbe: ReturnType<typeof setTimeout> | undefined;
    let previousState: 'unknown' | 'online' | 'offline' | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const checkReadiness = (currentProbe: number, canRetry: boolean) => {
      setReadiness(null);
      void withTimeout(
        Promise.resolve().then(() => oxygenNativeSession().capabilities(true)),
        8000,
        unavailable
      ).then(
        () => {
          if (currentProbe === probe)
            setReadiness({ scope, reason: undefined });
        },
        () => {
          if (currentProbe !== probe) return;
          setReadiness({ scope, reason: unavailable });
          if (canRetry) {
            retry = setTimeout(() => checkReadiness(currentProbe, false), 2000);
          }
        }
      );
    };

    const scheduleUnknownProbe = () => {
      const currentProbe = ++probe;
      delayedProbe = setTimeout(() => checkReadiness(currentProbe, true), 1500);
    };
    scheduleUnknownProbe();
    const unsubscribe = NetInfo.addEventListener((state) => {
      const network =
        state.isConnected === false || state.isInternetReachable === false
          ? 'offline'
          : state.isConnected === true && state.isInternetReachable === true
            ? 'online'
            : 'unknown';
      if (network === previousState) return;
      previousState = network;
      clearTimeout(retry);
      clearTimeout(delayedProbe);
      const currentProbe = ++probe;
      if (network === 'online') checkReadiness(currentProbe, true);
      else if (network === 'offline')
        setReadiness({ scope, reason: unavailable });
      else {
        setReadiness(null);
        scheduleUnknownProbe();
      }
    });
    return () => {
      ++probe;
      clearTimeout(retry);
      clearTimeout(delayedProbe);
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
