import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import NotificationsScreen from '@/app/notifications';

const mockUseRequireAuth = jest.fn();
const mockUseAuthStore = jest.fn<() => string | null>();
const mockSavingsNotificationsScreen = jest.fn(
  ({ merchantId }: { merchantId: string | null; userId: string | null }) => (
    <View
      accessibilityLabel={merchantId ?? 'none'}
      testID="savings-notifications-screen"
    />
  )
);
const mockRedirect = jest.fn(({ href }: { href: string }) => (
  <View testID="notifications-redirect" accessibilityLabel={href} />
));
const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => mockRedirect({ href }),
  Stack: { Screen: () => null },
  router: { push: (href: string) => mockRouterPush(href) },
}));

jest.mock('@/components/notifications/SavingsNotificationsScreen', () => ({
  SavingsNotificationsScreen: ({
    merchantId,
    userId,
  }: {
    merchantId: string | null;
    userId: string | null;
  }) => mockSavingsNotificationsScreen({ merchantId, userId }),
}));

jest.mock('@/hooks/use-auth-guard', () => ({
  useRequireAuth: () => mockUseRequireAuth(),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: {
      merchantId: string | null;
      user: { id: string } | null;
    }) => unknown
  ) => selector({ merchantId: mockUseAuthStore(), user: { id: 'user-a' } }),
}));

jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: '00000000-0000-4000-8000-000000000010' },
}));

describe('NotificationsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRequireAuth.mockReturnValue({ redirectTo: null });
    mockUseAuthStore.mockReturnValue('00000000-0000-4000-8000-000000000011');
  });

  it('passes the authenticated merchant scope to the savings inbox', () => {
    render(<NotificationsScreen />);

    expect(mockSavingsNotificationsScreen).toHaveBeenCalledWith({
      merchantId: '00000000-0000-4000-8000-000000000011',
      userId: 'user-a',
    });
    expect(
      screen.getByLabelText('00000000-0000-4000-8000-000000000011')
    ).toBeOnTheScreen();
  });

  it('uses the configured merchant only when auth has not hydrated merchant context', () => {
    mockUseAuthStore.mockReturnValue(null);

    render(<NotificationsScreen />);

    expect(mockSavingsNotificationsScreen).toHaveBeenCalledWith({
      merchantId: '00000000-0000-4000-8000-000000000010',
      userId: 'user-a',
    });
  });

  it('redirects to login when the auth guard returns a redirect target', () => {
    mockUseRequireAuth.mockReturnValue({
      redirectTo: '/auth/login?returnTo=%2Fnotifications',
    });

    render(<NotificationsScreen />);

    expect(mockRedirect).toHaveBeenCalledWith({
      href: '/auth/login?returnTo=%2Fnotifications',
    });
    expect(
      screen.getByLabelText('/auth/login?returnTo=%2Fnotifications')
    ).toBeOnTheScreen();
    expect(mockSavingsNotificationsScreen).not.toHaveBeenCalled();
  });

  it('keeps order updates reachable from the savings inbox', () => {
    render(<NotificationsScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'View your orders' }));

    expect(mockRouterPush).toHaveBeenCalledWith('/orders');
  });
});
