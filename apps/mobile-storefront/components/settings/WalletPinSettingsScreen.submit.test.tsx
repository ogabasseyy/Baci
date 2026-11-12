import { act, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
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
const serverError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

const ACTION = { set: 'Save PIN', change: 'Change PIN', reset: 'Reset PIN' };

/** Walks every step for the mode and saves, waiting for the answer. */
async function saveFlow(
  mode: 'set' | 'change' | 'reset',
  next = '5678',
  current = '1234'
) {
  if (mode === 'change') enterStep(current);
  enterStep(next);
  enterPin(next);
  await act(async () => press(ACTION[mode]));
}

describe('WalletPinSettingsScreen', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    ready();
  });

  it('set success calls the API once and shows the saved state, not an alert', async () => {
    set.mockResolvedValue(undefined);
    render(<WalletPinSettingsScreen />);
    await saveFlow('set', '1234');
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('set', '1234', 'user-1');
    expect(screen.getByRole('header', { name: 'PIN set' })).toBeTruthy();
    expect(
      screen.getByText('You’ll use it whenever money leaves your wallet.')
    ).toBeTruthy();
    expect(screen.queryByText('1234')).toBeNull();
    expect(router.back).not.toHaveBeenCalled();
  });

  it.each([
    ['set', {}, 'PIN set'],
    ['change', { hasPin: true }, 'PIN changed'],
    ['reset', { hasPin: true, resetRequired: true }, 'PIN reset'],
  ] as const)('%s success confirms, then Done goes back and refreshes in the background', async (mode, over, title) => {
    ready(over);
    set.mockResolvedValue(undefined);
    change.mockResolvedValue(undefined);
    (router.canGoBack as jest.Mock).mockReturnValue(true);
    render(<WalletPinSettingsScreen />);
    await saveFlow(mode);
    expect(screen.getByRole('header', { name: title })).toBeTruthy();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
    press('Done');
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('change sends the current and new PIN together', async () => {
    ready({ hasPin: true });
    change.mockResolvedValue(undefined);
    render(<WalletPinSettingsScreen />);
    await saveFlow('change', '5678', '1234');
    expect(change).toHaveBeenCalledWith(
      { currentPin: '1234', newPin: '5678' },
      'user-1'
    );
  });

  it('falls back to Settings when there is no history', async () => {
    set.mockResolvedValue(undefined);
    (router.canGoBack as jest.Mock).mockReturnValue(false);
    render(<WalletPinSettingsScreen />);
    await saveFlow('set');
    press('Done');
    expect(router.replace).toHaveBeenCalledWith('/settings');
    expect(router.back).not.toHaveBeenCalled();
  });

  it.each([
    'throw',
    'reject',
  ] as const)('still navigates away when the background status refresh %ss', async (failureMode) => {
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
    await saveFlow('set');
    await act(async () => {
      expect(() => press('Done')).not.toThrow();
      await Promise.resolve();
    });
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('PIN_INCORRECT shows the server message and starts again at the current PIN', async () => {
    ready({ hasPin: true });
    change.mockRejectedValue(
      serverError('PIN_INCORRECT', 'That PIN is not right.')
    );
    render(<WalletPinSettingsScreen />);
    await saveFlow('change', '5678', '1111');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('That PIN is not right.')).toBeTruthy();
    expect(
      screen.getByRole('header', { name: 'Enter your current PIN' })
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Enter your current PIN, 0 of 6 digits entered')
    ).toBeTruthy();
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('falls back to a plain message for an unnamed failure', async () => {
    set.mockRejectedValue('boom');
    render(<WalletPinSettingsScreen />);
    await saveFlow('set');
    expect(
      screen.getByText('Something went wrong. Please try again.')
    ).toBeTruthy();
  });

  it('PIN_ALREADY_SET switches to change mode and re-reads status', async () => {
    set.mockRejectedValue(serverError('PIN_ALREADY_SET', 'already'));
    render(<WalletPinSettingsScreen />);
    await saveFlow('set');
    expect(
      screen.getByRole('header', { name: 'Enter your current PIN' })
    ).toBeTruthy();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('PIN_NOT_SET switches to set mode', async () => {
    ready({ hasPin: true });
    change.mockRejectedValue(serverError('PIN_NOT_SET', 'none'));
    render(<WalletPinSettingsScreen />);
    await saveFlow('change');
    expect(
      screen.getByRole('header', { name: 'Choose a wallet PIN' })
    ).toBeTruthy();
  });

  it('PIN_RESET_REQUIRED switches to reset mode', async () => {
    ready({ hasPin: true });
    change.mockRejectedValue(serverError('PIN_RESET_REQUIRED', 'reset'));
    render(<WalletPinSettingsScreen />);
    await saveFlow('change');
    expect(
      screen.getByRole('header', { name: 'Choose a new PIN' })
    ).toBeTruthy();
    expect(screen.queryByText('Forgot your PIN?')).toBeNull();
  });

  it('a double tap sends one request and the pad stays locked while saving', async () => {
    let resolve: () => void = () => undefined;
    set.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    render(<WalletPinSettingsScreen />);
    enterStep('1234');
    enterPin('1234');
    press('Save PIN');
    expect(set).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Continue' }).props.accessibilityState
    ).toEqual({ disabled: true, busy: true });
    press('Continue');
    enterPin('1');
    expect(
      screen.getByLabelText('Choose a wallet PIN, 0 of 6 digits entered')
    ).toBeTruthy();
    expect(set).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
  });
});
