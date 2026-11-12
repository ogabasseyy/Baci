import { render, screen } from '@testing-library/react-native';
import { submitWalletPin } from '@/lib/wallet-pin-api';
import { changeWalletPin } from '@/lib/wallet-pin-change-api';
import { WalletPinSettingsScreen } from './WalletPinSettingsScreen';
import {
  enterPin,
  enterStep,
  pressButton as press,
} from './wallet-pin-settings.test-support';

const mockRefresh = jest.fn();
const mockSignOut = jest.fn();
let mockGate: { state: string; status: unknown; refresh: () => void };
let mockAuth: { isLoading: boolean; redirectTo: string | null };

jest.mock('./use-wallet-pin-settings-gate', () => ({
  useWalletPinSettingsGate: () => mockGate,
}));
jest.mock('@/lib/wallet-pin-api', () => ({ submitWalletPin: jest.fn() }));
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
jest.mock('@/hooks/use-auth-guard', () => ({
  useRequireAuth: () => mockAuth,
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
    selector({ user: { id: 'user-1' }, signOut: mockSignOut }),
}));

const set = submitWalletPin as jest.Mock;
const change = changeWalletPin as jest.Mock;
const status = (over: object = {}) => ({
  primary: true,
  hasPin: false,
  resetRequired: false,
  available: true,
  ...over,
});
const ready = (over: object = {}) => {
  mockGate = { state: 'ready', status: status(over), refresh: mockRefresh };
};

describe('WalletPinSettingsScreen', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockAuth = { isLoading: false, redirectTo: null };
    ready();
  });

  it('shows a labelled spinner while checking', () => {
    mockGate = { state: 'checking', status: null, refresh: mockRefresh };
    render(<WalletPinSettingsScreen />);
    expect(screen.getByLabelText('Checking your wallet PIN')).toBeTruthy();
    expect(screen.queryByText('Choose a wallet PIN')).toBeNull();
  });

  it('shows the spinner, not a redirect, while auth is not initialized', () => {
    mockAuth = { isLoading: true, redirectTo: null };
    mockGate = { state: 'off', status: null, refresh: mockRefresh };
    render(<WalletPinSettingsScreen />);
    expect(screen.getByLabelText('Checking your wallet PIN')).toBeTruthy();
    expect(screen.queryByText('redirect:/settings')).toBeNull();
  });

  it('redirects to settings when auth is initialized and the gate is off', () => {
    mockGate = { state: 'off', status: null, refresh: mockRefresh };
    render(<WalletPinSettingsScreen />);
    expect(screen.getByText('redirect:/settings')).toBeTruthy();
  });

  it('set mode asks for a new PIN on the in-app pad, never the phone keyboard', () => {
    render(<WalletPinSettingsScreen />);
    expect(
      screen.getByRole('header', { name: 'Choose a wallet PIN' })
    ).toBeTruthy();
    expect(screen.getByText('4 to 6 digits')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete digit' })).toBeTruthy();
    expect(
      screen.UNSAFE_queryAllByType(require('react-native').TextInput)
    ).toHaveLength(0);
    expect(screen.queryByText('Enter your current PIN')).toBeNull();
  });

  it('keeps Continue grey and inactive until four digits are in', () => {
    render(<WalletPinSettingsScreen />);
    enterPin('123');
    expect(
      screen.getByRole('button', { name: 'Continue' }).props.accessibilityState
        .disabled
    ).toBe(true);
    enterPin('4');
    expect(
      screen.getByRole('button', { name: 'Continue' }).props.accessibilityState
        .disabled
    ).toBe(false);
  });

  it('shows only the count of digits, never the digits', () => {
    render(<WalletPinSettingsScreen />);
    enterPin('1234');
    expect(
      screen.getByLabelText('Choose a wallet PIN, 4 of 6 digits entered')
    ).toBeTruthy();
    expect(screen.queryByText('1234')).toBeNull();
  });

  it('change mode starts with the current PIN and offers Forgot your PIN?', () => {
    ready({ hasPin: true });
    render(<WalletPinSettingsScreen />);
    expect(
      screen.getByRole('header', { name: 'Enter your current PIN' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Forgot your PIN?' })
    ).toBeTruthy();
    enterStep('1234');
    expect(
      screen.getByRole('header', { name: 'Choose a new PIN' })
    ).toBeTruthy();
    expect(screen.queryByText('Forgot your PIN?')).toBeNull();
    enterStep('5678');
    expect(
      screen.getByRole('header', { name: 'Confirm your new PIN' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change PIN' })).toBeTruthy();
  });

  it('reset mode when the server requires it starts at the new PIN', () => {
    ready({ hasPin: true, resetRequired: true });
    render(<WalletPinSettingsScreen />);
    expect(
      screen.getByRole('header', { name: 'Choose a new PIN' })
    ).toBeTruthy();
    expect(screen.queryByText('Forgot your PIN?')).toBeNull();
    enterStep('2468');
    expect(screen.getByRole('button', { name: 'Reset PIN' })).toBeTruthy();
  });

  it('Forgot your PIN? switches to reset mode', () => {
    ready({ hasPin: true });
    render(<WalletPinSettingsScreen />);
    press('Forgot your PIN?');
    expect(
      screen.getByRole('header', { name: 'Choose a new PIN' })
    ).toBeTruthy();
    expect(screen.queryByText('Enter your current PIN')).toBeNull();
    enterStep('2468');
    expect(screen.getByRole('button', { name: 'Reset PIN' })).toBeTruthy();
  });

  it('stops at six digits', () => {
    render(<WalletPinSettingsScreen />);
    enterPin('12345678');
    expect(
      screen.getByLabelText('Choose a wallet PIN, 6 of 6 digits entered')
    ).toBeTruthy();
  });

  it('a mismatch goes back to choosing the PIN and sends nothing', () => {
    render(<WalletPinSettingsScreen />);
    enterStep('1234');
    enterStep('4321', 'Save PIN');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('The two PINs do not match.')).toBeTruthy();
    expect(
      screen.getByRole('header', { name: 'Choose a wallet PIN' })
    ).toBeTruthy();
    expect(set).not.toHaveBeenCalled();
  });

  it('change mode rejects a new PIN equal to the current one', () => {
    ready({ hasPin: true });
    render(<WalletPinSettingsScreen />);
    enterStep('1234');
    enterStep('1234');
    expect(
      screen.getByText('Choose a different PIN from your current one.')
    ).toBeTruthy();
    expect(
      screen.getByRole('header', { name: 'Choose a new PIN' })
    ).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
  });

  it('typing again clears the last error', () => {
    render(<WalletPinSettingsScreen />);
    enterStep('1234');
    enterStep('4321', 'Save PIN');
    enterPin('1');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
