import type { DevicePushToken } from 'expo-notifications';
import { useEffect, useEffectEvent, useRef } from 'react';
import { AppState } from 'react-native';
import { getNativePushRegistration } from '@/lib/hosted-staging-push-capability';
import { isPushOptedOut } from '@/lib/push-token-storage';
import { registerForPushNotifications } from '@/services/push-notifications';

type RefreshState = {
  userId: string | null;
  merchantId: string | null;
  token: string | null;
};

export function usePushTokenRefresh({
  getState,
  onToken,
  retry,
}: {
  getState: () => RefreshState;
  onToken: (token: string) => Promise<void>;
  retry: () => Promise<void>;
}) {
  const mounted = useRef(false);
  const sequence = useRef(0);
  const refresh = useEffectEvent(async (devicePushToken?: DevicePushToken) => {
    const identity = getState();
    const capability = getNativePushRegistration();
    if (
      !mounted.current ||
      !identity.userId ||
      !identity.merchantId ||
      !capability
    )
      return;
    const attempt = ++sequence.current;
    const isCurrent = () => {
      const current = getState();
      const currentCapability = getNativePushRegistration();
      return (
        mounted.current &&
        sequence.current === attempt &&
        current.userId === identity.userId &&
        current.merchantId === identity.merchantId &&
        currentCapability !== null &&
        currentCapability.projectId === capability.projectId
      );
    };
    try {
      if ((await isPushOptedOut(identity.userId)) || !isCurrent()) return;
      const token = await registerForPushNotifications({
        requestPermission: false,
        ...(devicePushToken ? { devicePushToken } : {}),
      });
      if (
        !token ||
        !isCurrent() ||
        (await isPushOptedOut(identity.userId)) ||
        !isCurrent()
      )
        return;
      await onToken(token);
    } catch {
      return;
    }
  });
  const foreground = useEffectEvent(async () => {
    if (getState().token) await retry();
    else await refresh();
  });

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let tokenSubscription: { remove: () => void } | undefined;
    const appStateSubscription = AppState.addEventListener(
      'change',
      (state) => {
        if (state === 'active') void foreground();
      }
    );
    const subscribe = async () => {
      if (!getNativePushRegistration()) return;
      try {
        const notifications = await import('expo-notifications');
        if (!active) return;
        tokenSubscription = notifications.addPushTokenListener((token) => {
          void refresh(token);
        });
      } catch {
        return;
      }
    };
    void subscribe();
    return () => {
      active = false;
      mounted.current = false;
      sequence.current += 1;
      appStateSubscription?.remove();
      tokenSubscription?.remove();
    };
  }, []);
}
