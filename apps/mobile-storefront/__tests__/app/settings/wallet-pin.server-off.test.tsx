import { render, screen } from '@testing-library/react-native';
import WalletPinRoute from '@/app/settings/wallet-pin';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { fetchWalletPinStatus, submitWalletPin } from '@/lib/wallet-pin-api';
import { changeWalletPin } from '@/lib/wallet-pin-change-api';

jest.mock('@/lib/piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { read: jest.fn() },
}));
jest.mock('@/lib/wallet-pin-api', () => ({
  fetchWalletPinStatus: jest.fn(),
  submitWalletPin: jest.fn(),
}));
jest.mock('@/lib/wallet-pin-change-api', () => ({
  changeWalletPin: jest.fn(),
}));
jest.mock('expo-router', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    Redirect: ({ href }: { href: string }) => <Text>{`redirect:${href}`}</Text>,
    Stack: { Screen: () => null },
    useNavigation: () => ({ addListener: () => () => undefined }),
  };
});
// The PIN screen's back guard (#4230) needs a navigator this test has none of.
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: jest.fn(),
}));
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
    selector({
      user: { id: 'user-1' },
      merchantId: 'merchant-1',
      signOut: jest.fn(),
    }),
}));

describe('settings/wallet-pin route when the server keeps PiggyVest off', () => {
  it('redirects to settings with no PIN UI and no PIN POST', async () => {
    (piggyvestPrimaryWalletApi.read as jest.Mock).mockRejectedValue(
      Object.assign(new Error('x'), { code: 'PIGGYVEST_NOT_READY' })
    );
    (fetchWalletPinStatus as jest.Mock).mockResolvedValue({
      primary: false,
      hasPin: false,
      resetRequired: false,
      available: false,
    });
    render(<WalletPinRoute />);
    expect(await screen.findByText('redirect:/settings')).toBeTruthy();
    expect(screen.queryByLabelText(/PIN/)).toBeNull();
    expect(submitWalletPin).not.toHaveBeenCalled();
    expect(changeWalletPin).not.toHaveBeenCalled();
  });
});
