import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { submitWalletPin } from '@/lib/wallet-pin-api';
import { changeWalletPin } from '@/lib/wallet-pin-change-api';
import { WalletPinSettingsScreen } from './WalletPinSettingsScreen';

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
const type = (label: string, value: string) =>
  fireEvent.changeText(screen.getByLabelText(label), value);
const press = (name: string) =>
  fireEvent.press(screen.getByRole('button', { name }));

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
    expect(screen.queryByText('Set a wallet PIN')).toBeNull();
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

  it('set mode: heading, fields and button', () => {
    render(<WalletPinSettingsScreen />);
    expect(
      screen.getByRole('header', { name: 'Set a wallet PIN' })
    ).toBeTruthy();
    expect(screen.getByLabelText('New PIN')).toBeTruthy();
    expect(screen.getByLabelText('Confirm PIN')).toBeTruthy();
    expect(screen.queryByLabelText('Current PIN')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save PIN' })).toBeTruthy();
  });

  it('change mode: heading, fields, button and forgot link', () => {
    ready({ hasPin: true });
    render(<WalletPinSettingsScreen />);
    expect(screen.getByText('Change your PIN')).toBeTruthy();
    for (const l of ['Current PIN', 'New PIN', 'Confirm new PIN'])
      expect(screen.getByLabelText(l)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change PIN' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Forgot your PIN?' })
    ).toBeTruthy();
  });

  it('keeps the PIN fields in a keyboard-aware scroll area', () => {
    ready({ hasPin: true });
    render(<WalletPinSettingsScreen />);
    const { KeyboardAwareScrollView } = jest.requireMock(
      'react-native-keyboard-controller'
    );
    const scroll = screen.UNSAFE_getByType(KeyboardAwareScrollView);
    expect(scroll.props.keyboardDismissMode).toBe('on-drag');
    expect(within(scroll).getByLabelText('Confirm new PIN')).toBeTruthy();
  });

  it('reset mode when the server requires it', () => {
    ready({ hasPin: true, resetRequired: true });
    render(<WalletPinSettingsScreen />);
    expect(screen.getByText('Reset your PIN')).toBeTruthy();
    expect(screen.getByText('Choose a new 4 to 6 digit PIN.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset PIN' })).toBeTruthy();
    expect(screen.queryByText('Forgot your PIN?')).toBeNull();
  });

  it('Forgot your PIN? switches to reset mode', () => {
    ready({ hasPin: true });
    render(<WalletPinSettingsScreen />);
    press('Forgot your PIN?');
    expect(screen.getByText('Reset your PIN')).toBeTruthy();
    expect(screen.queryByLabelText('Current PIN')).toBeNull();
  });

  it('filters non-digits out of PIN fields', () => {
    render(<WalletPinSettingsScreen />);
    type('New PIN', '12a3-45678');
    expect(screen.getByLabelText('New PIN').props.value).toBe('123456');
  });

  it.each([
    ['short PIN', '123', '123', 'Enter 4 to 6 digits.'],
    ['mismatch', '1234', '4321', 'The two PINs do not match.'],
  ])('%s shows an error and sends nothing', (_l, a, b, message) => {
    render(<WalletPinSettingsScreen />);
    type('New PIN', a);
    type('Confirm PIN', b);
    press('Save PIN');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
    expect(set).not.toHaveBeenCalled();
  });

  it('change mode rejects a new PIN equal to the current one', () => {
    ready({ hasPin: true });
    render(<WalletPinSettingsScreen />);
    type('Current PIN', '1234');
    type('New PIN', '1234');
    type('Confirm new PIN', '1234');
    press('Change PIN');
    expect(
      screen.getByText('Choose a different PIN from your current one.')
    ).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
  });
});
