import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { NotificationResponse } from 'expo-notifications';
import { usePushNotifications } from './use-push-notifications';

const mockPush = jest.fn();
const mockInvalidate = jest.fn();
const mockClear = jest.fn();
const mockLastResponse = jest.fn();
const mockAuth = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  user: { id: 'legacy-user' },
  customer: { id: 'legacy-customer' },
};
jest.mock('expo-router', () => ({
  router: { push: (value: unknown) => mockPush(value) },
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn() }),
}));
jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: '11111111-1111-4111-8111-111111111111' },
}));
jest.mock('@/lib/hosted-staging-push-capability', () => ({
  getNativePushRegistration: () => true,
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: typeof mockAuth) => unknown) => selector(mockAuth),
    { getState: () => mockAuth }
  ),
}));
jest.mock('./use-savings-push-registration', () => ({
  useSavingsPushRegistration: () => ({
    error: 'PIGGYVEST_NOT_READY',
    isLoading: false,
    isRegistered: false,
    registeredUserId: null,
    pushToken: null,
    register: jest.fn(),
    unregister: jest.fn(),
  }),
}));
jest.mock('@/services/analytics', () => ({
  trackNotificationInteraction: jest.fn(),
}));
jest.mock('@/services/savings-wallet-cache', () => ({
  invalidateSavingsWalletCache: () => mockInvalidate(),
}));
jest.mock('@/services/push-notifications', () => ({
  handleNotificationResponse: (
    _response: unknown,
    navigate: (screen: string) => void
  ) => navigate('utility-history'),
}));
jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: () => ({ remove: jest.fn() }),
  addNotificationResponseReceivedListener: () => ({ remove: jest.fn() }),
  getLastNotificationResponseAsync: () => mockLastResponse(),
  clearLastNotificationResponse: () => mockClear(),
}));

it('keeps ordinary push navigation working after handoff when savings registration is server-off', async () => {
  const response: NotificationResponse = {
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: {
      date: 100,
      request: {
        identifier: 'server-off-legacy-promotion',
        trigger: null,
        content: {
          title: 'Offer',
          subtitle: null,
          body: null,
          categoryIdentifier: null,
          sound: null,
          launchImageName: null,
          badge: null,
          attachments: [],
          threadIdentifier: null,
          data: { notification_type: 'promotion' },
        },
      },
    },
  };
  mockLastResponse.mockResolvedValue(response);
  const view = renderHook(
    ({ ready }: { ready: boolean }) =>
      usePushNotifications({ navigationReady: ready }),
    { initialProps: { ready: false } }
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockPush).not.toHaveBeenCalled();
  expect(mockLastResponse).not.toHaveBeenCalled();
  view.rerender({ ready: true });
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
  expect(view.result.current.error).toBe('PIGGYVEST_NOT_READY');
  expect(mockInvalidate).not.toHaveBeenCalled();
  view.unmount();
});
