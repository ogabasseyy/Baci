import { afterEach, beforeEach, describe, expect, jest } from '@jest/globals';
import { act, render, waitFor } from '@testing-library/react-native';
import { registerRootLayoutAttTests } from '@/test-support/root-layout-att-test-cases';
import { registerRootLayoutIntroTests } from '@/test-support/root-layout-intro-test-cases';
import {
  mockActivateDueSavingsReminderNotification,
  mockBuildReminderScope,
  mockCancelScopeSavingsReminders,
} from '@/test-support/root-layout-reminder-mock';
import { registerRootLayoutReminderTests } from '@/test-support/root-layout-reminder-test-cases';
import { registerRootLayoutSplashContractTests } from '@/test-support/root-layout-splash-contract-test-cases';
import { registerRootLayoutSplashRecoveryTests } from '@/test-support/root-layout-splash-recovery-test-cases';

const mockHideSplash = jest.fn<(options: unknown) => Promise<void>>();
const mockWaitForIntro = jest.fn<() => Promise<boolean>>();
const mockInitializeStorage = jest.fn<() => Promise<void>>();
const mockInitializeAuth = jest.fn<() => Promise<void>>();
const mockCleanup = jest.fn();
const mockRegisterPushNotifications = jest.fn();
const mockPrefetchStartupStorefrontData = jest.fn<() => Promise<void>>();
const mockInitializeAdTrackingForStartup = jest.fn<() => Promise<void>>();
const mockUseAppTrackingTransparency = jest.fn();
const mockRootLayoutNavMount = jest.fn();
const mockRootLayoutNavUnmount = jest.fn();
const mockUsePushNotifications = jest.fn();
const mockVerifyBenchmarkTelemetry = jest.fn<() => Promise<void>>();
let mockFontsLoaded = true;
let mockTrackingAuthorizationSettled = true;
let mockAutoLayout = true;
let mockResolveSplashHide: () => void = () => {};

async function finishNativeSplash() {
  await waitFor(() => expect(mockHideSplash).toHaveBeenCalled());
  await act(async () => mockResolveSplashHide());
}
const mockAuthState = {
  cleanup: mockCleanup,
  initialize: mockInitializeAuth,
  isInitialized: true,
  merchantId: null as string | null,
  user: null as { id: string } | null,
};

jest.mock('../../global.css', () => ({}));

jest.mock('expo-font', () => ({
  useFonts: () => [mockFontsLoaded, null],
}));

jest.mock('react-native-splash-motion', () => ({
  __esModule: true,
  default: {
    hide: (options: unknown) => mockHideSplash(options),
    waitForIntro: () => mockWaitForIntro(),
  },
}));

jest.mock('@/components/navigation/RootLayoutNav', () => ({
  RootLayoutNav: ({
    adTrackingReady,
    persistenceEnabled,
    shouldResumeNavigation,
    onFirstLayout,
  }: {
    adTrackingReady?: boolean;
    persistenceEnabled: boolean;
    shouldResumeNavigation?: boolean;
    onFirstLayout?: () => void;
  }) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    const { act } = jest.requireActual<
      typeof import('@testing-library/react-native')
    >('@testing-library/react-native');
    const { Text } =
      jest.requireActual<typeof import('react-native')>('react-native');
    useEffect(() => {
      mockRootLayoutNavMount();
      if (mockAutoLayout) act(() => onFirstLayout?.());
      return () => {
        mockRootLayoutNavUnmount();
      };
    }, []);

    return (
      <Text
        onLayout={onFirstLayout}
        accessibilityLabel="Store navigation"
        accessibilityRole="text"
        testID="root-layout-nav"
      >
        adTracking:{String(adTrackingReady)};persistence:
        {String(persistenceEnabled)};resume:
        {String(shouldResumeNavigation)}
      </Text>
    );
  },
}));

jest.mock(
  '@/components/navigation/StartupRecoveryScreen',
  () => ({
    StartupRecoveryScreen: ({ onLayout }: { onLayout?: () => void }) => {
      const { Text } =
        jest.requireActual<typeof import('react-native')>('react-native');
      return (
        <Text testID="startup-recovery" onLayout={onLayout}>
          Startup recovery
        </Text>
      );
    },
  }),
  { virtual: true }
);

jest.mock('@/lib/verify-benchmark-telemetry', () => ({
  verifyBenchmarkTelemetry: () => mockVerifyBenchmarkTelemetry(),
}));

jest.mock('@/components/ErrorBoundary', () => ({
  ErrorFallback: () => null,
}));

jest.mock('@/hooks/use-push-notifications', () => ({
  usePushNotifications: (options: unknown) => {
    mockUsePushNotifications(options);
    return {
      isLoading: false,
      isRegistered: false,
      register: mockRegisterPushNotifications,
      registeredUserId: null,
    };
  },
}));

jest.mock('@/hooks/use-app-tracking-transparency', () => ({
  useAppTrackingTransparency: (options: { enabled: boolean }) => {
    mockUseAppTrackingTransparency(options);
    return {
      isTrackingAuthorizationSettled: mockTrackingAuthorizationSettled,
    };
  },
}));

jest.mock('@/lib/offline-queue', () => ({
  offlineQueue: {
    destroy: jest.fn(),
    initialize: jest.fn(() => Promise.resolve()),
    registerHandler: jest.fn(),
  },
}));

jest.mock('@/lib/storage', () => ({
  DEFAULT_SYNC_STORAGE_KEYS: ['cart-storage'],
  initializeStorage: () => mockInitializeStorage(),
}));

jest.mock('@/lib/startup-storefront-prefetch', () => ({
  prefetchStartupStorefrontData: () => mockPrefetchStartupStorefrontData(),
}));

jest.mock('@/services/analytics', () => ({
  initAnalytics: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/services/initialize-ad-tracking-for-startup', () => ({
  initializeAdTrackingForStartup: () => mockInitializeAdTrackingForStartup(),
}));

jest.mock('@/services/orders', () => ({
  createOrder: jest.fn(),
}));

jest.mock('@/services/savings-reminder-notifications', () => ({
  activateDueSavingsReminderNotification:
    mockActivateDueSavingsReminderNotification,
  buildReminderScope: mockBuildReminderScope,
  cancelScopeSavingsReminders: mockCancelScopeSavingsReminders,
}));

jest.mock('@/stores/auth-store', () => ({
  // useAuthStore is a Zustand-style mock: callable as a selector over
  // mockAuthState while also exposing getState() for direct store reads.
  // subscribe mirrors the real zustand store API used by the queued
  // create-order handler registered during layout init.
  useAuthStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector(mockAuthState),
    {
      getState: () => mockAuthState,
      subscribe: () => () => undefined,
    }
  ),
}));

const { default: RootLayout, resetRootLayoutBootstrapStateForTest } =
  require('@/app/_layout') as typeof import('@/app/_layout');

describe('RootLayout storage boot gate', () => {
  beforeEach(() => {
    resetRootLayoutBootstrapStateForTest();
    jest.clearAllMocks();
    mockActivateDueSavingsReminderNotification.mockResolvedValue(null);
    mockCancelScopeSavingsReminders.mockResolvedValue(false);
    jest.useFakeTimers();
    mockWaitForIntro.mockResolvedValue(true);
    mockHideSplash.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          mockResolveSplashHide = resolve;
        })
    );
    mockInitializeAuth.mockResolvedValue(undefined);
    mockInitializeAdTrackingForStartup.mockResolvedValue(undefined);
    mockPrefetchStartupStorefrontData.mockResolvedValue(undefined);
    mockTrackingAuthorizationSettled = true;
    mockAutoLayout = true;
    mockFontsLoaded = true;
    mockVerifyBenchmarkTelemetry.mockResolvedValue(undefined);
    mockAuthState.isInitialized = true;
    mockAuthState.merchantId = null;
    mockAuthState.user = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  registerRootLayoutIntroTests({
    renderRoot: () => {
      render(<RootLayout />);
    },
    mockWaitForIntro,
    mockInitializeStorage,
    mockPrefetchStartupStorefrontData,
    mockRootLayoutNavMount,
    mockHideSplash,
    setFontsLoaded: (loaded) => {
      mockFontsLoaded = loaded;
    },
  });

  registerRootLayoutSplashRecoveryTests({
    RootLayout,
    authState: mockAuthState,
    initializeStorage: mockInitializeStorage,
    prefetchStartupStorefrontData: mockPrefetchStartupStorefrontData,
    hideSplash: mockHideSplash,
    useAppTrackingTransparency: mockUseAppTrackingTransparency,
    usePushNotifications: mockUsePushNotifications,
    verifyBenchmarkTelemetry: mockVerifyBenchmarkTelemetry,
    rootLayoutNavMount: mockRootLayoutNavMount,
    rootLayoutNavUnmount: mockRootLayoutNavUnmount,
    setAutoLayout: (enabled) => {
      mockAutoLayout = enabled;
    },
    finishNativeSplash,
  });

  registerRootLayoutSplashContractTests({
    RootLayout,
    authState: mockAuthState,
    initializeStorage: mockInitializeStorage,
    hideSplash: mockHideSplash,
    waitForIntro: mockWaitForIntro,
    usePushNotifications: mockUsePushNotifications,
    finishNativeSplash,
  });

  registerRootLayoutAttTests({
    RootLayout,
    cleanupAuth: mockCleanup,
    authState: mockAuthState,
    initializeStorage: mockInitializeStorage,
    initializeAdTrackingForStartup: mockInitializeAdTrackingForStartup,
    registerPushNotifications: mockRegisterPushNotifications,
    activateDueSavingsReminderNotification:
      mockActivateDueSavingsReminderNotification,
    useAppTrackingTransparency: mockUseAppTrackingTransparency,
    finishNativeSplash,
    setTrackingAuthorizationSettled: (settled) => {
      mockTrackingAuthorizationSettled = settled;
    },
  });

  registerRootLayoutReminderTests({
    RootLayout,
    authState: mockAuthState,
    initializeStorage: mockInitializeStorage,
    activateDueSavingsReminderNotification:
      mockActivateDueSavingsReminderNotification,
  });
});
