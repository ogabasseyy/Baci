import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  confirmIdentityCode,
  sendIdentityCode,
} from '@/lib/wallet-identity-confirm-api';
import { submitWalletPin } from '@/lib/wallet-pin-api';
import { WalletPinSettingsScreen } from './WalletPinSettingsScreen';

const mockRefresh = jest.fn();
const mockNavigation = { addListener: () => () => undefined };
let mockGate: { state: string; status: unknown; refresh: () => void };

jest.mock('./use-wallet-pin-settings-gate', () => ({
  useWalletPinSettingsGate: () => mockGate,
}));
jest.mock('@/lib/wallet-pin-api', () => ({ submitWalletPin: jest.fn() }));
jest.mock('@/lib/wallet-identity-confirm-api', () => ({
  sendIdentityCode: jest.fn(),
  confirmIdentityCode: jest.fn(),
}));
jest.mock('@/lib/wallet-pin-change-api', () => ({
  changeWalletPin: jest.fn(),
}));
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: jest.fn(),
}));
jest.mock('expo-router', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    router: { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() },
    Redirect: ({ href }: { href: string }) => <Text>{`redirect:${href}`}</Text>,
    Stack: { Screen: () => null },
    useNavigation: () => mockNavigation,
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
jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: ({ children }: { children?: React.ReactNode }) => {
    const { View } = jest.requireActual('react-native');
    return <View>{children}</View>;
  },
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'user-1', email: 'bassey@example.com' } }),
}));

const set = submitWalletPin as jest.Mock;
const ready = (over: object = {}) => {
  mockGate = {
    state: 'ready',
    status: {
      primary: true,
      hasPin: false,
      resetRequired: false,
      available: true,
      ...over,
    },
    refresh: mockRefresh,
  };
};
const press = (name: string) =>
  fireEvent.press(screen.getByRole('button', { name }));

async function confirmWithCode() {
  await act(async () => press('Send code'));
  for (const digit of '123456') press(digit);
  await act(async () => press('Confirm'));
}

describe('bugfix: Settings > Wallet PIN told customers to sign out', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(sendIdentityCode).mockResolvedValue(undefined);
    jest.mocked(confirmIdentityCode).mockResolvedValue(undefined);
  });

  it('shows "Confirm it\'s you" before the PIN form when the sign-in is old, then the form', async () => {
    ready({ signInConfirmationRequired: true });
    render(<WalletPinSettingsScreen />);
    expect(screen.getByText("Confirm it's you")).toBeTruthy();
    expect(screen.queryByText('Choose a wallet PIN')).toBeNull();
    await confirmWithCode();
    expect(confirmIdentityCode).toHaveBeenCalledWith({
      email: 'bassey@example.com',
      code: '123456',
      expectedUserId: 'user-1',
    });
    expect(
      screen.getByRole('header', { name: 'Choose a wallet PIN' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('routes a save-time REAUTHENTICATION_REQUIRED to the code step and saves the kept PIN', async () => {
    ready({ hasPin: true, resetRequired: true });
    set
      .mockRejectedValueOnce(
        Object.assign(new Error('Please sign in again to continue.'), {
          code: 'REAUTHENTICATION_REQUIRED',
        })
      )
      .mockResolvedValueOnce(undefined);
    render(<WalletPinSettingsScreen />);
    for (const digit of '2468') press(digit);
    press('Continue');
    for (const digit of '2468') press(digit);
    await act(async () => press('Reset PIN'));
    expect(screen.getByText("Confirm it's you")).toBeTruthy();
    expect(screen.queryByText('Please sign in again to continue.')).toBeNull();
    await confirmWithCode();
    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenLastCalledWith('reset', '2468', 'user-1');
    expect(screen.getByRole('header', { name: 'PIN reset' })).toBeTruthy();
  });

  it('never asks to confirm for a PIN change', () => {
    ready({ hasPin: true, signInConfirmationRequired: true });
    render(<WalletPinSettingsScreen />);
    expect(
      screen.getByRole('header', { name: 'Enter your current PIN' })
    ).toBeTruthy();
    expect(screen.queryByText("Confirm it's you")).toBeNull();
  });
});
