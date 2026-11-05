import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { submitWalletPin } from '@/lib/wallet-pin-api';
import { changeWalletPin } from '@/lib/wallet-pin-change-api';
import { WalletPinSettingsScreen } from './WalletPinSettingsScreen';

const mockRefresh = jest.fn();
const mockSignOut = jest.fn();
let mockGate: { state: string; status: unknown; refresh: () => void };

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
const serverError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

describe('WalletPinSettingsScreen', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    ready();
  });

  it('shows a labelled spinner while checking', () => {
    mockGate = { state: 'checking', status: null, refresh: mockRefresh };
    render(<WalletPinSettingsScreen />);
    expect(screen.getByLabelText('Checking your wallet PIN')).toBeTruthy();
    expect(screen.queryByText('Set a wallet PIN')).toBeNull();
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

  it('set success calls the API once, clears fields and re-reads status', async () => {
    set.mockResolvedValue(undefined);
    render(<WalletPinSettingsScreen />);
    type('New PIN', '1234');
    type('Confirm PIN', '1234');
    await act(async () => press('Save PIN'));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('set', '1234', 'user-1');
    expect(screen.getByText('Your wallet PIN has been saved.')).toBeTruthy();
    expect(screen.getByLabelText('New PIN').props.value).toBe('');
    // The form moves to change mode once a PIN exists.
    expect(screen.getByLabelText('Confirm new PIN').props.value).toBe('');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('change success sends both PINs and reports it', async () => {
    ready({ hasPin: true });
    change.mockResolvedValue(undefined);
    render(<WalletPinSettingsScreen />);
    type('Current PIN', '1234');
    type('New PIN', '5678');
    type('Confirm new PIN', '5678');
    await act(async () => press('Change PIN'));
    expect(change).toHaveBeenCalledWith(
      { currentPin: '1234', newPin: '5678' },
      'user-1'
    );
    expect(screen.getByText('Your wallet PIN has been changed.')).toBeTruthy();
    expect(screen.getByLabelText('Current PIN').props.value).toBe('');
  });

  it('reset success uses the reset call', async () => {
    ready({ hasPin: true, resetRequired: true });
    set.mockResolvedValue(undefined);
    render(<WalletPinSettingsScreen />);
    type('New PIN', '2468');
    type('Confirm PIN', '2468');
    await act(async () => press('Reset PIN'));
    expect(set).toHaveBeenCalledWith('reset', '2468', 'user-1');
    expect(screen.getByText('Your wallet PIN has been reset.')).toBeTruthy();
  });

  it('PIN_INCORRECT shows the server message and clears the fields', async () => {
    ready({ hasPin: true });
    change.mockRejectedValue(
      serverError('PIN_INCORRECT', 'That PIN is not right.')
    );
    render(<WalletPinSettingsScreen />);
    type('Current PIN', '1111');
    type('New PIN', '5678');
    type('Confirm new PIN', '5678');
    await act(async () => press('Change PIN'));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('That PIN is not right.')).toBeTruthy();
    for (const l of ['Current PIN', 'New PIN', 'Confirm new PIN'])
      expect(screen.getByLabelText(l).props.value).toBe('');
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('falls back to a plain message for an unnamed failure', async () => {
    set.mockRejectedValue('boom');
    render(<WalletPinSettingsScreen />);
    type('New PIN', '1234');
    type('Confirm PIN', '1234');
    await act(async () => press('Save PIN'));
    expect(
      screen.getByText('Something went wrong. Please try again.')
    ).toBeTruthy();
  });

  it('PIN_ALREADY_SET switches to change mode and re-reads status', async () => {
    set.mockRejectedValue(serverError('PIN_ALREADY_SET', 'already'));
    render(<WalletPinSettingsScreen />);
    type('New PIN', '1234');
    type('Confirm PIN', '1234');
    await act(async () => press('Save PIN'));
    expect(screen.getByText('Change your PIN')).toBeTruthy();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('PIN_NOT_SET switches to set mode', async () => {
    ready({ hasPin: true });
    change.mockRejectedValue(serverError('PIN_NOT_SET', 'none'));
    render(<WalletPinSettingsScreen />);
    type('Current PIN', '1234');
    type('New PIN', '5678');
    type('Confirm new PIN', '5678');
    await act(async () => press('Change PIN'));
    expect(screen.getByText('Set a wallet PIN')).toBeTruthy();
  });

  it('PIN_RESET_REQUIRED switches to reset mode', async () => {
    ready({ hasPin: true });
    change.mockRejectedValue(serverError('PIN_RESET_REQUIRED', 'reset'));
    render(<WalletPinSettingsScreen />);
    type('Current PIN', '1234');
    type('New PIN', '5678');
    type('Confirm new PIN', '5678');
    await act(async () => press('Change PIN'));
    expect(screen.getByText('Reset your PIN')).toBeTruthy();
  });

  it('REAUTHENTICATION_REQUIRED guides to sign out; signOut only after confirm', async () => {
    ready({ hasPin: true, resetRequired: true });
    set.mockRejectedValue(
      serverError(
        'REAUTHENTICATION_REQUIRED',
        'Please sign in again to continue.'
      )
    );
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    render(<WalletPinSettingsScreen />);
    type('New PIN', '2468');
    type('Confirm PIN', '2468');
    await act(async () => press('Reset PIN'));
    expect(
      screen.getByText(
        'For your security, please sign out and sign in again, then come back to reset your PIN.'
      )
    ).toBeTruthy();
    press('Sign out');
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(alert.mock.calls[0][0]).toBe('Sign out?');
    const buttons = alert.mock.calls[0][2] ?? [];
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Sign out']);
    buttons[0].onPress?.();
    expect(mockSignOut).not.toHaveBeenCalled();
    buttons[1].onPress?.();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('a double tap sends one request', async () => {
    let resolve: () => void = () => undefined;
    set.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    render(<WalletPinSettingsScreen />);
    type('New PIN', '1234');
    type('Confirm PIN', '1234');
    press('Save PIN');
    press('Save PIN');
    expect(set).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Save PIN' }).props.accessibilityState
        .disabled
    ).toBe(true);
    await act(async () => resolve());
  });

  it('keeps no PIN text in any field after submit', async () => {
    set.mockResolvedValue(undefined);
    render(<WalletPinSettingsScreen />);
    type('New PIN', '1234');
    type('Confirm PIN', '1234');
    await act(async () => press('Save PIN'));
    expect(screen.queryByDisplayValue('1234')).toBeNull();
  });
});
