import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState } from 'react-native';
import {
  getCrashBreadcrumbsForTest,
  resetCrashDiagnosticsForTest,
} from '@/lib/crash-diagnostics';
import { registerRootLayoutAttTests } from '@/test-support/root-layout-att-test-cases';
import { registerRootLayoutIntroTests } from '@/test-support/root-layout-intro-test-cases';
import {
  mockActivateDueSavingsReminderNotification,
  mockBuildReminderScope,
  mockCancelScopeSavingsReminders,
} from '@/test-support/root-layout-reminder-mock';

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
    const { Text } =
      jest.requireActual<typeof import('react-native')>('react-native');
    useEffect(() => {
      mockRootLayoutNavMount();
      if (mockAutoLayout) onFirstLayout?.();
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

jest.mock('@/lib/benchmark-telemetry-check', () => ({
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

// Same pattern as memory-warning-diagnostics.test.ts: the RN preset's
// AppState.addEventListener does not return a working subscription here,
// so install a per-test mock (restored afterwards) instead of spying.
function mockAppStateListener() {
  const original = AppState.addEventListener;
  const addEventListener = jest.fn(
    (_event: string, _handler: (state: string) => void) => ({
      remove: jest.fn(),
    })
  );
  Object.defineProperty(AppState, 'addEventListener', {
    configurable: true,
    value: addEventListener,
  });
  return {
    addEventListener,
    restoreAppState: () => {
      Object.defineProperty(AppState, 'addEventListener', {
        configurable: true,
        value: original,
      });
    },
  };
}

function latestChangeHandler(
  addEventListener: ReturnType<typeof mockAppStateListener>['addEventListener']
) {
  const handlers = addEventListener.mock.calls
    .filter(([event]) => event === 'change')
    .map(([, handler]) => handler);
  expect(handlers.length).toBeGreaterThan(0);
  return handlers[handlers.length - 1];
}

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

  it('keeps the splash until the navigation shell has laid out', async () => {
    mockAutoLayout = false;
    mockInitializeStorage.mockResolvedValue(undefined);
    render(<RootLayout />);
    await waitFor(() =>
      expect(screen.getByTestId('root-layout-nav')).toBeOnTheScreen()
    );
    expect(mockHideSplash).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(7999);
    });
    expect(mockHideSplash).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(mockHideSplash).not.toHaveBeenCalled();
    fireEvent(screen.getByTestId('root-layout-nav'), 'layout');
    await waitFor(() => expect(mockHideSplash).toHaveBeenCalledTimes(1));
    expect(mockHideSplash).toHaveBeenCalledWith({
      waitForLoop: false,
      minDuration: 0,
      fade: 220,
    });
  });

  it('does not restart the timeout when auth becomes ready', async () => {
    mockAutoLayout = false;
    mockAuthState.isInitialized = false;
    mockInitializeStorage.mockResolvedValue(undefined);
    const view = render(<RootLayout />);
    await waitFor(() =>
      expect(screen.getByTestId('root-layout-nav')).toBeOnTheScreen()
    );
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    mockAuthState.isInitialized = true;
    view.rerender(<RootLayout />);
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(mockHideSplash).not.toHaveBeenCalled();
    fireEvent(screen.getByTestId('root-layout-nav'), 'layout');
    await waitFor(() => expect(mockHideSplash).toHaveBeenCalledTimes(1));
    expect(mockHideSplash).toHaveBeenCalledWith({
      waitForLoop: false,
      minDuration: 0,
      fade: 220,
    });
  });

  it('dismisses when a delayed navigation layout arrives', async () => {
    mockAutoLayout = false;
    mockInitializeStorage.mockResolvedValue(undefined);
    render(<RootLayout />);
    await waitFor(() =>
      expect(screen.getByTestId('root-layout-nav')).toBeOnTheScreen()
    );
    expect(mockHideSplash).not.toHaveBeenCalled();
    fireEvent(screen.getByTestId('root-layout-nav'), 'layout');
    await waitFor(() => expect(mockHideSplash).toHaveBeenCalledTimes(1));
  });

  it('waits for native splash dismissal before enabling ATT and persistence', async () => {
    let finishHide: () => void = () => {};
    mockInitializeStorage.mockResolvedValue(undefined);
    mockHideSplash.mockReturnValue(
      new Promise<void>((resolve) => {
        finishHide = resolve;
      })
    );
    render(<RootLayout />);
    await waitFor(() => expect(mockHideSplash).toHaveBeenCalledTimes(1));
    expect(mockHideSplash).toHaveBeenCalledWith({
      waitForLoop: false,
      minDuration: 0,
      fade: 220,
    });
    expect(mockUseAppTrackingTransparency).toHaveBeenLastCalledWith({
      enabled: false,
    });
    expect(mockUsePushNotifications).toHaveBeenLastCalledWith({
      navigationReady: false,
    });
    expect(mockVerifyBenchmarkTelemetry).not.toHaveBeenCalled();
    expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
      /persistence:false/
    );
    await act(async () => finishHide());
    await waitFor(() =>
      expect(mockUseAppTrackingTransparency).toHaveBeenLastCalledWith({
        enabled: true,
      })
    );
    expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
      /persistence:true/
    );
    expect(mockUsePushNotifications).toHaveBeenLastCalledWith({
      navigationReady: true,
    });
    expect(mockVerifyBenchmarkTelemetry).toHaveBeenCalledTimes(1);
  });

  it('unblocks startup if the native hide request rejects', async () => {
    mockInitializeStorage.mockResolvedValue(undefined);
    mockHideSplash.mockRejectedValue(new Error('native splash unavailable'));

    render(<RootLayout />);

    await waitFor(() =>
      expect(mockUseAppTrackingTransparency).toHaveBeenLastCalledWith({
        enabled: true,
      })
    );
    expect(mockHideSplash).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
      /persistence:true/
    );
  });

  it('does not mount persisted navigation when the splash timeout fires before storage is ready', async () => {
    mockInitializeStorage.mockReturnValue(new Promise(() => undefined));

    render(<RootLayout />);

    expect(mockPrefetchStartupStorefrontData).toHaveBeenCalledTimes(1);
    expect(mockHideSplash).not.toHaveBeenCalled();
    expect(screen.queryByTestId('root-layout-nav')).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(8000);
    });

    expect(mockHideSplash).not.toHaveBeenCalled();
    expect(screen.queryByTestId('root-layout-nav')).toBeNull();
  });

  it('keeps the global auth subscription alive when the root view unmounts', async () => {
    mockInitializeStorage.mockResolvedValue(undefined);

    const { unmount } = render(<RootLayout />);

    await waitFor(() => {
      expect(mockInitializeStorage).toHaveBeenCalledTimes(1);
    });

    unmount();

    expect(mockCleanup).not.toHaveBeenCalled();
  });

  it('keeps the navigator mounted when the startup splash finishes', async () => {
    mockInitializeStorage.mockResolvedValue(undefined);

    render(<RootLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
        'adTracking:true;persistence:false;resume:false'
      );
    });
    expect(mockRootLayoutNavMount).toHaveBeenCalledTimes(1);

    await finishNativeSplash();

    await waitFor(() => {
      expect(mockUseAppTrackingTransparency).toHaveBeenLastCalledWith({
        enabled: true,
      });
    });
    expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
      'adTracking:true;persistence:true;resume:true'
    );
    expect(mockRootLayoutNavMount).toHaveBeenCalledTimes(1);
    expect(mockRootLayoutNavUnmount).not.toHaveBeenCalled();
  });

  it('keeps route navigation mounted while startup ad tracking finishes', async () => {
    let resolveAdTrackingStartup: () => void = () => {};
    mockInitializeStorage.mockResolvedValue(undefined);
    mockInitializeAdTrackingForStartup.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveAdTrackingStartup = resolve;
      })
    );

    render(<RootLayout />);

    await waitFor(() => {
      expect(mockInitializeAdTrackingForStartup).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
      'adTracking:false;persistence:false;resume:false'
    );

    await act(async () => {
      resolveAdTrackingStartup();
    });

    await waitFor(() => {
      expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
        'adTracking:true;persistence:false;resume:false'
      );
    });
  });

  registerRootLayoutAttTests({
    RootLayout,
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

  it('does not replay the animated splash after a completed boot remount', async () => {
    mockInitializeStorage.mockResolvedValue(undefined);

    const firstRender = render(<RootLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
        'adTracking:true;persistence:false;resume:false'
      );
    });

    await finishNativeSplash();

    await waitFor(() => {
      expect(mockUseAppTrackingTransparency).toHaveBeenLastCalledWith({
        enabled: true,
      });
    });
    expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
      'adTracking:true;persistence:true;resume:true'
    );

    firstRender.unmount();
    render(<RootLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('root-layout-nav')).toHaveTextContent(
        'adTracking:true;persistence:true;resume:true'
      );
    });
    expect(mockHideSplash).toHaveBeenCalledTimes(1);
  });

  it('activates due savings reminders when the app foregrounds', async () => {
    mockAuthState.user = { id: 'customer-1' };
    mockInitializeStorage.mockResolvedValue(undefined);
    const { addEventListener, restoreAppState } = mockAppStateListener();

    try {
      render(<RootLayout />);
      await waitFor(() => {
        expect(screen.getByTestId('root-layout-nav')).toBeOnTheScreen();
      });

      const onChange = latestChangeHandler(addEventListener);
      const before =
        mockActivateDueSavingsReminderNotification.mock.calls.length;
      act(() => {
        onChange('active');
      });
      expect(mockActivateDueSavingsReminderNotification.mock.calls.length).toBe(
        before + 1
      );
      act(() => {
        onChange('background');
      });
      expect(mockActivateDueSavingsReminderNotification.mock.calls.length).toBe(
        before + 1
      );
    } finally {
      restoreAppState();
    }
  });

  it('skips foreground reminder activation while logged out', async () => {
    mockAuthState.user = null;
    mockInitializeStorage.mockResolvedValue(undefined);
    const { addEventListener, restoreAppState } = mockAppStateListener();

    try {
      render(<RootLayout />);
      await waitFor(() => {
        expect(addEventListener).toHaveBeenCalled();
      });

      mockActivateDueSavingsReminderNotification.mockClear();
      act(() => {
        latestChangeHandler(addEventListener)('active');
      });
      expect(mockActivateDueSavingsReminderNotification).not.toHaveBeenCalled();
    } finally {
      restoreAppState();
    }
  });

  it('records a breadcrumb instead of throwing when foreground activation rejects', async () => {
    mockAuthState.user = { id: 'customer-1' };
    mockInitializeStorage.mockResolvedValue(undefined);
    const { addEventListener, restoreAppState } = mockAppStateListener();

    try {
      render(<RootLayout />);
      await waitFor(() => {
        expect(screen.getByTestId('root-layout-nav')).toBeOnTheScreen();
      });

      // The boot effect already fired activation on mount; arm the
      // rejection for the foreground call specifically.
      mockActivateDueSavingsReminderNotification.mockClear();
      mockActivateDueSavingsReminderNotification.mockRejectedValueOnce(
        new Error('storage unavailable')
      );
      resetCrashDiagnosticsForTest();
      await act(async () => {
        latestChangeHandler(addEventListener)('active');
        await Promise.resolve();
      });

      expect(
        getCrashBreadcrumbsForTest().filter(
          (crumb) =>
            crumb.name === 'root_layout:savings_reminder_activation_failed'
        )
      ).toHaveLength(1);
    } finally {
      restoreAppState();
    }
  });

  it('skips foreground reminder activation before boot is ready', async () => {
    mockAuthState.user = { id: 'customer-1' };
    mockAuthState.isInitialized = false;
    mockInitializeStorage.mockResolvedValue(undefined);
    const { addEventListener, restoreAppState } = mockAppStateListener();

    try {
      render(<RootLayout />);
      await waitFor(() => {
        expect(addEventListener).toHaveBeenCalled();
      });

      mockActivateDueSavingsReminderNotification.mockClear();
      act(() => {
        latestChangeHandler(addEventListener)('active');
      });
      expect(mockActivateDueSavingsReminderNotification).not.toHaveBeenCalled();
    } finally {
      restoreAppState();
    }
  });
});
