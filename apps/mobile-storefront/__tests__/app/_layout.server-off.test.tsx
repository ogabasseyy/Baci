import { render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import RootLayout, {
  resetRootLayoutBootstrapStateForTest,
} from '@/app/_layout';
import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';
import { serverOffError } from '@/test-support/piggyvest-server-off.test-support';

const mockActivate = jest.fn();
const mockAuth = {
  user: { id: 'legacy-user' },
  merchantId: '11111111-1111-4111-8111-111111111111',
  isInitialized: true,
  initialize: jest.fn(async () => {}),
};
jest.mock('../../global.css', () => ({}));
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('@/hooks/use-native-splash-handoff', () => ({
  useNativeSplashHandoff: () => ({
    showSplash: false,
    shouldRenderApp: true,
    timedOut: false,
    onFirstLayout: jest.fn(),
  }),
}));
jest.mock('@/components/navigation/RootLayoutNav', () => ({
  RootLayoutNav: () => {
    const { createElement } = require('react');
    const { Text } = require('react-native');
    return createElement(Text, null, 'Storefront home');
  },
}));
jest.mock('@/components/navigation/RootStartupError', () => ({
  RootStartupError: () => null,
}));
jest.mock('@/hooks/use-app-tracking-transparency', () => ({
  useAppTrackingTransparency: () => ({ isTrackingAuthorizationSettled: true }),
}));
jest.mock('@/hooks/use-startup-ad-tracking-initialization', () => ({
  useStartupAdTrackingInitialization: () => ({
    isStartupAdTrackingReady: true,
  }),
}));
jest.mock('@/hooks/use-push-notifications', () => ({
  usePushNotifications: () => ({
    isRegistered: true,
    registeredUserId: 'legacy-user',
    isLoading: false,
    register: jest.fn(),
  }),
}));
jest.mock('@/lib/crash-diagnostics', () => ({
  installCrashDiagnostics: jest.fn(),
  recordCrashBreadcrumb: jest.fn(),
}));
jest.mock('@/lib/verify-benchmark-telemetry', () => ({
  verifyBenchmarkTelemetry: jest.fn(async () => {}),
}));
jest.mock('@/lib/offline-queue', () => ({
  offlineQueue: { initialize: jest.fn(async () => {}), destroy: jest.fn() },
}));
jest.mock('@/lib/register-queued-create-order-handler', () => ({
  registerQueuedCreateOrderHandler: jest.fn(),
}));
jest.mock('@/lib/startup-storefront-prefetch', () => ({
  prefetchStartupStorefrontData: jest.fn(async () => {}),
}));
jest.mock('@/lib/storage', () => ({
  DEFAULT_SYNC_STORAGE_KEYS: [],
  initializeStorage: jest.fn(async () => {}),
}));
jest.mock('@/services/analytics', () => ({
  initAnalytics: jest.fn(async () => {}),
}));
jest.mock('@/services/savings-reminder-notifications', () => ({
  activateDueSavingsReminderNotification: () => mockActivate(),
  buildReminderScope: (userId: string, merchantId: string) => ({
    userId,
    merchantId,
  }),
  cancelScopeSavingsReminders: jest.fn(async () => {}),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: typeof mockAuth) => unknown) => selector(mockAuth),
    { getState: () => mockAuth }
  ),
}));

it('still reaches the legacy storefront when optional savings activation returns server-off', async () => {
  resetRootLayoutBootstrapStateForTest();
  mockActivate.mockRejectedValue(serverOffError());
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() });
  const view = render(<RootLayout />);
  try {
    await waitFor(() =>
      expect(recordCrashBreadcrumb).toHaveBeenCalledWith(
        'root_layout:savings_reminder_activation_failed'
      )
    );
    expect(screen.getByText('Storefront home')).toBeOnTheScreen();
    expect(screen.queryByText(/set up.*piggyvest/i)).toBeNull();
  } finally {
    view.unmount();
    subscription.mockRestore();
  }
});
