import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { submitWalletPin } from '@/lib/wallet-pin-api';
import { changeWalletPin } from '@/lib/wallet-pin-change-api';
import { WalletPinSettingsScreen } from './WalletPinSettingsScreen';

const mockRefresh = jest.fn();
const mockSignOut = jest.fn();
const mockNavigation = { addListener: () => () => undefined };
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

  const alertSpy = () =>
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const doneButton = (alert: jest.SpyInstance) =>
    (alert.mock.calls[0][2] ?? []).find(
      (b: { text?: string }) => b.text === 'Done'
    );

  it('set success calls the API once, clears fields and confirms once', async () => {
    const alert = alertSpy();
    set.mockResolvedValue(undefined);
    render(<WalletPinSettingsScreen />);
    type('New PIN', '1234');
    type('Confirm PIN', '1234');
    await act(async () => press('Save PIN'));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('set', '1234', 'user-1');
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe('Your wallet PIN has been set.');
    // No duplicate inline message beside the confirmation.
    expect(screen.queryByText(/Your wallet PIN has been/)).toBeNull();
    expect(screen.getByLabelText('New PIN').props.value).toBe('');
    expect(screen.queryByDisplayValue('1234')).toBeNull();
    expect(router.back).not.toHaveBeenCalled();
  });

  it.each([
    ['set', {}, 'Save PIN', 'Your wallet PIN has been set.'],
    [
      'change',
      { hasPin: true },
      'Change PIN',
      'Your wallet PIN has been changed.',
    ],
    [
      'reset',
      { hasPin: true, resetRequired: true },
      'Reset PIN',
      'Your wallet PIN has been reset.',
    ],
  ])('%s success confirms, then Done goes back and refreshes in the background', async (mode, over, button, copy) => {
    ready(over);
    const alert = alertSpy();
    set.mockResolvedValue(undefined);
    change.mockResolvedValue(undefined);
    (router.canGoBack as jest.Mock).mockReturnValue(true);
    render(<WalletPinSettingsScreen />);
    if (mode === 'change') type('Current PIN', '1234');
    type('New PIN', '5678');
    type(mode === 'change' ? 'Confirm new PIN' : 'Confirm PIN', '5678');
    await act(async () => press(button));
    expect(alert.mock.calls[0][0]).toBe(copy);
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
    doneButton(alert).onPress();
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('falls back to Settings when there is no history', async () => {
    const alert = alertSpy();
    set.mockResolvedValue(undefined);
    (router.canGoBack as jest.Mock).mockReturnValue(false);
    render(<WalletPinSettingsScreen />);
    type('New PIN', '1234');
    type('Confirm PIN', '1234');
    await act(async () => press('Save PIN'));
    doneButton(alert).onPress();
    expect(router.replace).toHaveBeenCalledWith('/settings');
    expect(router.back).not.toHaveBeenCalled();
  });

  it.each([
    'throw',
    'reject',
  ] as const)('still navigates away when the background status refresh %ss', async (failureMode) => {
    const alert = alertSpy();
    set.mockResolvedValue(undefined);
    (router.canGoBack as jest.Mock).mockReturnValue(true);
    if (failureMode === 'throw') {
      mockRefresh.mockImplementation(() => {
        throw new Error('offline');
      });
    } else {
      mockRefresh.mockRejectedValue(new Error('offline'));
    }
    render(<WalletPinSettingsScreen />);
    type('New PIN', '1234');
    type('Confirm PIN', '1234');
    await act(async () => press('Save PIN'));
    await act(async () => {
      expect(() => doneButton(alert).onPress()).not.toThrow();
      await Promise.resolve();
    });
    expect(router.back).toHaveBeenCalledTimes(1);
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
