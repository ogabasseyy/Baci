import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import NotificationsScreen from '@/app/notifications';

const mockRouterPush = jest.fn();
const mockScreenOptions = jest.fn();

jest.mock('expo-router', () => ({
  Redirect: () => null,
  Stack: {
    Screen: ({ options }: { options: unknown }) => {
      mockScreenOptions(options);
      return null;
    },
  },
  router: { push: (href: string) => mockRouterPush(href) },
}));
// The savings inbox itself is what PiggyVest being off affects; here it is
// a stand-in that renders the footer it is handed.
jest.mock('@/components/notifications/SavingsNotificationsScreen', () => ({
  SavingsNotificationsScreen: ({ footer }: { footer?: ReactNode }) => (
    <>{footer}</>
  ),
}));
jest.mock('@/hooks/use-auth-guard', () => ({
  useRequireAuth: () => ({ isLoading: false, redirectTo: null }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: {
      merchantId: string | null;
      user: { id: string } | null;
    }) => unknown
  ) => selector({ merchantId: 'm-1', user: { id: 'user-a' } }),
}));
jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

// With PiggyVest off, the notifications screen keeps its name and the
// orders link still works.
describe('notifications route with the server off', () => {
  it('is titled Notifications and still links to orders', () => {
    render(<NotificationsScreen />);
    expect(mockScreenOptions).toHaveBeenCalledWith({ title: 'Notifications' });
    fireEvent.press(screen.getByRole('button', { name: 'View your orders' }));
    expect(mockRouterPush).toHaveBeenCalledWith('/orders');
  });
});
