import { render, screen } from '@testing-library/react-native';
import { submitWalletPin } from '@/lib/wallet-pin-api';
import { changeWalletPin } from '@/lib/wallet-pin-change-api';
import { WalletPinSettingsScreen } from './WalletPinSettingsScreen';

jest.mock('./use-wallet-pin-settings-gate', () => ({
  useWalletPinSettingsGate: () => ({
    state: 'off',
    status: null,
    refresh: jest.fn(),
  }),
}));
jest.mock('@/lib/wallet-pin-api', () => ({ submitWalletPin: jest.fn() }));
jest.mock('@/lib/wallet-pin-change-api', () => ({
  changeWalletPin: jest.fn(),
}));
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: jest.fn(),
}));
jest.mock('expo-router', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    Redirect: ({ href }: { href: string }) => <Text>{`redirect:${href}`}</Text>,
    Stack: { Screen: () => null },
    useNavigation: () => ({ addListener: () => () => undefined }),
  };
});
jest.mock('@/hooks/use-auth-guard', () => ({
  useRequireAuth: () => ({ isLoading: false, redirectTo: null }),
}));
jest.mock('@/hooks/use-storefront-insets', () => ({
  useStorefrontInsets: () => ({ getScrollContentStyle: () => ({}) }),
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'user-1' }, signOut: jest.fn() }),
}));

describe('wallet PIN screen when the server keeps PiggyVest off', () => {
  it('shows nothing PIN related, redirects to settings and posts nothing', () => {
    render(<WalletPinSettingsScreen />);
    expect(screen.getByText('redirect:/settings')).toBeTruthy();
    expect(screen.queryByText(/PIN/)).toBeNull();
    expect(screen.queryByLabelText(/PIN/)).toBeNull();
    expect(submitWalletPin).not.toHaveBeenCalled();
    expect(changeWalletPin).not.toHaveBeenCalled();
  });
});
