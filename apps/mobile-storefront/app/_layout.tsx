import { useFonts } from 'expo-font';
import '../global.css';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_900Black,
} from '@expo-google-fonts/inter';
import { useEffect, useRef, useState } from 'react';
import { RootLayoutNav } from '@/components/navigation/RootLayoutNav';

export { RootLayoutErrorBoundary as ErrorBoundary } from '@/components/navigation/RootLayoutErrorBoundary';

import { StartupPlaceholder } from '@/components/navigation/StartupPlaceholder';
import { StartupRecoveryScreen } from '@/components/navigation/StartupRecoveryScreen';
import { useAppTrackingTransparency } from '@/hooks/use-app-tracking-transparency';
import { useNativeSplashHandoff } from '@/hooks/use-native-splash-handoff';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { useSavingsReminderActivation } from '@/hooks/use-savings-reminder-activation';
import { useStartupAdTrackingInitialization } from '@/hooks/use-startup-ad-tracking-initialization';
import { useStartupTelemetryVerification } from '@/hooks/use-startup-telemetry-verification';
import {
  installCrashDiagnostics,
  recordCrashBreadcrumb,
} from '@/lib/crash-diagnostics';
import { offlineQueue } from '@/lib/offline-queue';
import { registerQueuedCreateOrderHandler } from '@/lib/register-queued-create-order-handler';
import { prefetchStartupStorefrontData } from '@/lib/startup-storefront-prefetch';
import { markStartupTiming } from '@/lib/startup-timing';
import { DEFAULT_SYNC_STORAGE_KEYS, initializeStorage } from '@/lib/storage';
import { initAnalytics } from '@/services/analytics';
import { useAuthStore } from '@/stores/auth-store';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

const bootstrapState = {
  hasCompletedInitialBoot: false,
  isStorageReady: false,
};

function resetRootLayoutBootstrapState() {
  bootstrapState.hasCompletedInitialBoot = false;
  bootstrapState.isStorageReady = false;
}

export function resetRootLayoutBootstrapStateForTest() {
  if (process.env.NODE_ENV === 'test') {
    resetRootLayoutBootstrapState();
  }
}

if (process.env.NODE_ENV === 'development') {
  const hotModule = module as {
    hot?: { dispose(callback: () => void): void };
  };
  hotModule.hot?.dispose(resetRootLayoutBootstrapState);
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_900Black,
  });

  const initialize = useAuthStore((state) => state.initialize);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const storeUser = useAuthStore((state) => state.user);
  const storeMerchantId = useAuthStore((state) => state.merchantId);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const pushAttemptsRef = useRef<{ userId: string | null; count: number }>({
    userId: null,
    count: 0,
  });
  const [hasCompletedInitialBoot, setHasCompletedInitialBoot] = useState(
    () => bootstrapState.hasCompletedInitialBoot
  );
  const [isStorageReady, setIsStorageReady] = useState(
    () => bootstrapState.isStorageReady
  );
  const {
    showSplash,
    onFirstLayout,
    shouldRenderApp,
    timedOut,
    nativeSplashVisible,
    shouldShowStartupRecovery,
  } = useNativeSplashHandoff({
    initialVisible: !bootstrapState.hasCompletedInitialBoot,
    ready: loaded && isInitialized && isStorageReady,
  });
  const {
    register: registerPushNotifications,
    isRegistered: isPushRegistered,
    registeredUserId,
    isLoading: isPushLoading,
  } = usePushNotifications({
    navigationReady: !showSplash && loaded && isStorageReady && isInitialized,
  });
  useStartupTelemetryVerification({
    appInitialized: isInitialized,
    loaded,
    nativeIntroSettled: shouldRenderApp,
    showSplash,
    storageReady: isStorageReady,
    timedOut,
  });
  const { isTrackingAuthorizationSettled } = useAppTrackingTransparency({
    enabled: !showSplash && isInitialized && isStorageReady,
  });
  const isPushRegisteredForCurrentUser = Boolean(
    storeUser?.id && isPushRegistered && registeredUserId === storeUser.id
  );

  useEffect(() => {
    markStartupTiming('root_mounted');
    installCrashDiagnostics('RootLayout');
    recordCrashBreadcrumb('root_layout:mounted');
    return () => recordCrashBreadcrumb('root_layout:unmounted');
  }, []);

  useEffect(() => {
    if (!isInitialized) {
      initPromiseRef.current = null;
    }
  }, [isInitialized]);

  useSavingsReminderActivation({
    storeUser,
    storeMerchantId,
    isInitialized,
    isStorageReady,
    isTrackingAuthorizationSettled,
  });

  const { isStartupAdTrackingReady } = useStartupAdTrackingInitialization({
    isInitialized,
    isStorageReady,
    isTrackingAuthorizationSettled,
  });

  useEffect(() => {
    let isMounted = true;
    const markStorageReady = () => {
      bootstrapState.isStorageReady = true;
      if (isMounted) {
        setIsStorageReady(true);
      }
    };

    const initializeApp = async () => {
      recordCrashBreadcrumb('root_layout:initialize_start');
      void prefetchStartupStorefrontData();
      recordCrashBreadcrumb('root_layout:startup_prefetch_scheduled');

      await initializeStorage(DEFAULT_SYNC_STORAGE_KEYS);
      markStorageReady();
      recordCrashBreadcrumb('root_layout:storage_ready', {
        storageKeyCount: DEFAULT_SYNC_STORAGE_KEYS.length,
      });

      if (!useAuthStore.getState().isInitialized) {
        await initialize();
      }
      recordCrashBreadcrumb('root_layout:auth_initialized', {
        hasUser: Boolean(useAuthStore.getState().user?.id),
      });
      await initAnalytics();
      await offlineQueue.initialize();
      recordCrashBreadcrumb('root_layout:offline_queue_initialized');
      registerQueuedCreateOrderHandler();
      recordCrashBreadcrumb('root_layout:initialize_complete');
    };

    if (!initPromiseRef.current) {
      initPromiseRef.current = initializeApp().catch((err) => {
        // Ensure splash screen dismisses even if post-auth init (analytics,
        // offline queue) throws. Auth-store already sets isInitialized on its
        // own errors, but failures after that point were previously unhandled
        // and could leave Android stuck on the splash screen. Storage readiness
        // is latched only after initializeStorage succeeds above.
        console.error('App initialization error:', err);
        recordCrashBreadcrumb('root_layout:initialize_error', {
          message: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return () => {
      isMounted = false;
      offlineQueue.destroy();
    };
  }, [initialize]);

  // Latch boot completion inline during render so the first commit after the
  // splash hides already resumes navigation, with no stale intermediate frame
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  if (
    !hasCompletedInitialBoot &&
    !showSplash &&
    isInitialized &&
    isStorageReady
  ) {
    setHasCompletedInitialBoot(true);
  }

  useEffect(() => {
    if (hasCompletedInitialBoot) {
      bootstrapState.hasCompletedInitialBoot = true;
    }
  }, [hasCompletedInitialBoot]);

  // Clear attempt tracking on logout so the same account can re-register
  // after signing out and back in.
  useEffect(() => {
    if (!storeUser?.id) {
      pushAttemptsRef.current = { userId: null, count: 0 };
    }
  }, [storeUser?.id]);

  // Register for push only after auth is fully initialized and user is logged in.
  // merchantId is optional for storefront (single-merchant app).
  // Allows up to 3 attempts per userId to handle cases where permissions are
  // granted after the first attempt. Stops retrying after success or max attempts.
  useEffect(() => {
    const maxAttempts = 3;
    const ref = pushAttemptsRef.current;
    const isNewUser = ref.userId !== storeUser?.id;
    const attemptsLeft = isNewUser || ref.count < maxAttempts;

    if (
      isInitialized &&
      isTrackingAuthorizationSettled &&
      storeUser?.id &&
      !isPushRegisteredForCurrentUser &&
      !isPushLoading &&
      attemptsLeft
    ) {
      if (isNewUser) {
        pushAttemptsRef.current = { userId: storeUser.id, count: 1 };
      } else {
        pushAttemptsRef.current.count += 1;
      }
      void registerPushNotifications(
        storeUser.id,
        storeMerchantId ?? undefined
      );
    }
  }, [
    isInitialized,
    isPushRegisteredForCurrentUser,
    isPushLoading,
    isTrackingAuthorizationSettled,
    registerPushNotifications,
    storeUser?.id,
    storeMerchantId,
  ]);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  const timedOutStartupBlocked =
    timedOut &&
    (!shouldRenderApp || !loaded || !isStorageReady || !isInitialized);

  if (
    shouldShowStartupRecovery ||
    (timedOutStartupBlocked && !nativeSplashVisible)
  ) {
    return <StartupRecoveryScreen onLayout={onFirstLayout} />;
  }

  if (!shouldRenderApp || timedOutStartupBlocked) {
    return <StartupPlaceholder showProgress={timedOutStartupBlocked} />;
  }

  if (!loaded) {
    return null;
  }

  if (!isStorageReady) return null;

  return (
    <RootLayoutNav
      onFirstLayout={onFirstLayout}
      adTrackingReady={isStartupAdTrackingReady}
      persistenceEnabled={!showSplash}
      shouldResumeNavigation={hasCompletedInitialBoot}
    />
  );
}
