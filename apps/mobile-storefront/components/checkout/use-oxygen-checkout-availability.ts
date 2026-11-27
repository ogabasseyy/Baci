import { withTimeout } from '@baci/shared';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { allowsLocalOxygenNetwork } from '@/lib/api-core';
import { getOxygenMobileProfile } from '@/lib/oxygen-mobile-profile';
import { oxygenNativeSession } from '@/services/oxygen/native-session';
import { useAuthStore } from '@/stores/auth-store';
import type { CartItem } from '@/stores/cart-store';

const unavailable =
  'Oxygen checkout is unavailable. Check your connection and try again.';
const retryDelaysMs = [2000, 8000];

async function checkGuestOxygenStorefrontAvailability(
  apiOrigin: string,
  merchantId: string
): Promise<boolean> {
  const response = await fetch(
    `${apiOrigin}/api/payments/oxygen/storefront-availability?merchantId=${encodeURIComponent(merchantId)}`,
    { headers: { Accept: 'application/json' } }
  );
  if (!response.ok) throw new Error(unavailable);
  const body = (await response.json()) as { available?: unknown };
  return body.available === true;
}

export function useOxygenCheckoutAvailability(_items: CartItem[]) {
  const userId = useAuthStore((state) => state.user?.id);
  const customerId = useAuthStore((state) => state.customer?.id);
  const customerUserId = useAuthStore((state) => state.customer?.user_id);
  const customerMerchantId = useAuthStore(
    (state) => state.customer?.merchant_id
  );
  const merchantId = useAuthStore((state) => state.merchantId);
  const profile = getOxygenMobileProfile();
  const profileApiOrigin = profile?.apiOrigin;
  const profileMerchantId = profile?.merchantId;
  const usesLocalNetwork =
    profile?.environment === 'staging' && allowsLocalOxygenNetwork();
  const linked =
    Boolean(userId && customerId) &&
    customerUserId === userId &&
    customerMerchantId === profile?.merchantId &&
    merchantId === profile?.merchantId;
  const isGuest = !userId;
  const probeMode: 'linked' | 'guest' | null = profile
    ? linked
      ? 'linked'
      : isGuest && profile.environment === 'production'
        ? 'guest'
        : null
    : null;
  const scope =
    profile && probeMode
      ? JSON.stringify([
          probeMode,
          userId ?? 'guest',
          customerId ?? 'guest',
          merchantId ?? profile.merchantId,
          profile.environment,
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
    if (!scope || !profileApiOrigin || !profileMerchantId || !probeMode) return;
    let probe = 0;
    let delayedProbe: ReturnType<typeof setTimeout> | undefined;
    let previousState: 'unknown' | 'online' | 'offline' | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const checkReadiness = (currentProbe: number, attempt = 0) => {
      setReadiness(null);
      const task: Promise<unknown> =
        probeMode === 'linked'
          ? Promise.resolve().then(() =>
              oxygenNativeSession().capabilities(true)
            )
          : checkGuestOxygenStorefrontAvailability(
              profileApiOrigin,
              profileMerchantId
            ).then((available) => {
              if (!available) throw new Error(unavailable);
            });
      void withTimeout(task, 8000, unavailable).then(
        () => {
          if (currentProbe === probe)
            setReadiness({ scope, reason: undefined });
        },
        () => {
          if (currentProbe !== probe) return;
          setReadiness({ scope, reason: unavailable });
          const delay = retryDelaysMs[attempt];
          if (delay !== undefined)
            retry = setTimeout(
              () => checkReadiness(currentProbe, attempt + 1),
              delay
            );
        }
      );
    };

    const scheduleUnknownProbe = () => {
      const currentProbe = ++probe;
      delayedProbe = setTimeout(() => checkReadiness(currentProbe), 1500);
    };
    scheduleUnknownProbe();
    const unsubscribe = NetInfo.addEventListener((state) => {
      const canReachApi = usesLocalNetwork || state.isInternetReachable;
      const network =
        state.isConnected === false || canReachApi === false
          ? 'offline'
          : state.isConnected === true && canReachApi === true
            ? 'online'
            : 'unknown';
      if (network === previousState) return;
      previousState = network;
      clearTimeout(retry);
      clearTimeout(delayedProbe);
      const currentProbe = ++probe;
      if (network === 'online') checkReadiness(currentProbe);
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
  }, [probeMode, profileApiOrigin, profileMerchantId, scope, usesLocalNetwork]);

  if (!profile) return { visible: false, disabledReason: undefined };
  const disabledReason =
    !linked && !probeMode
      ? 'Sign in with your linked customer account'
      : readiness?.scope !== scope
        ? 'Checking Oxygen availability'
        : readiness.reason;
  return {
    visible: profile.environment === 'staging' || disabledReason === undefined,
    disabledReason,
  };
}
