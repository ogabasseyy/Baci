import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import SettingsScreen from '@/app/settings';
import { SPACING } from '@/constants/Colors';

type MockStorefrontScreenShellProps = {
  children?: ReactNode;
  edges?: readonly string[];
};

const mockStorefrontScreenShell =
  jest.fn<({ children, edges }: MockStorefrontScreenShellProps) => void>();
const mockGetScrollContentStyle = jest.fn();
const mockRegisterPush = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockSetAppearance = jest.fn();
const mockToastError = jest.fn();
const mockUnregisterPush = jest.fn<() => Promise<void>>();
const mockUseStorefrontInsets = jest.fn();
const mockUsePushNotifications = jest.fn();
const mockUseToast = jest.fn();

jest.mock('expo-constants', () => ({
  expoConfig: { version: '2.4.1' },
}));

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: {
    Light: 'light',
  },
  impactAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
}));

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    __esModule: true,
    default: { View },
    FadeInDown: {
      delay: () => ({
        duration: () => ({}),
      }),
    },
  };
});

jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: ({
    children,
    ...props
  }: MockStorefrontScreenShellProps) => {
    const { View } =
      jest.requireActual<typeof import('react-native')>('react-native');
    mockStorefrontScreenShell({ children, ...props });
    return <View testID="storefront-screen-shell">{children}</View>;
  },
}));

jest.mock('@/components/ui/Toast', () => ({
  useToast: () => mockUseToast(),
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/hooks/use-push-notifications', () => ({
  usePushNotifications: () => mockUsePushNotifications(),
}));

jest.mock('@/hooks/use-storefront-insets', () => ({
  useStorefrontInsets: () => mockUseStorefrontInsets(),
}));

jest.mock('@/stores/settings-store', () => ({
  useSettingsStore: (
    selector: (state: {
      appearance: 'system' | 'light' | 'dark';
      setAppearance: (mode: 'system' | 'light' | 'dark') => void;
    }) => unknown
  ) =>
    selector({
      appearance: 'system',
      setAppearance: mockSetAppearance,
    }),
}));

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetScrollContentStyle.mockReturnValue({
      paddingTop: SPACING.md,
      paddingBottom: SPACING.xl,
    });
    mockUseStorefrontInsets.mockReturnValue({
      getListContentStyle: jest.fn(),
      getScrollContentStyle: mockGetScrollContentStyle,
    });
    mockUsePushNotifications.mockReturnValue({
      isLoading: false,
      isRegistered: true,
      register: mockRegisterPush,
      unregister: mockUnregisterPush,
    });
    mockUseToast.mockReturnValue({
      Toast: () => <View testID="toast-root" />,
      error: mockToastError,
      success: jest.fn(),
    });
  });

  it('uses the storefront shell and scroll inset helper for the settings layout', () => {
    render(<SettingsScreen />);

    const shellProps = mockStorefrontScreenShell.mock.calls[0]?.[0];

    expect(shellProps?.edges).toEqual(['bottom']);
    expect(mockGetScrollContentStyle).toHaveBeenCalledWith({
      includeBottomInset: false,
      paddingBottom: SPACING.xl,
    });
    expect(screen.getByText('APPEARANCE')).toBeOnTheScreen();
    expect(screen.getByText('NOTIFICATIONS')).toBeOnTheScreen();
  });

  it('updates the appearance mode when a segment is pressed', () => {
    render(<SettingsScreen />);

    fireEvent.press(screen.getByLabelText('Dark appearance mode'));

    expect(mockSetAppearance).toHaveBeenCalledWith('dark');
  });

  it('unregisters push notifications when the switch is turned off', () => {
    render(<SettingsScreen />);

    fireEvent(
      screen.getByLabelText('Toggle push notifications'),
      'valueChange',
      false
    );

    expect(mockUnregisterPush).toHaveBeenCalledTimes(1);
  });

  it('registers push notifications when the switch is turned on', () => {
    mockUsePushNotifications.mockReturnValue({
      isLoading: false,
      isRegistered: false,
      register: mockRegisterPush,
      unregister: mockUnregisterPush,
    });

    render(<SettingsScreen />);

    fireEvent(
      screen.getByLabelText('Toggle push notifications'),
      'valueChange',
      true
    );

    expect(mockRegisterPush).toHaveBeenCalledTimes(1);
  });

  it('shows an error toast when enabling notifications fails', async () => {
    mockUsePushNotifications.mockReturnValue({
      isLoading: false,
      isRegistered: false,
      register: mockRegisterPush,
      unregister: mockUnregisterPush,
    });
    mockRegisterPush.mockRejectedValueOnce(new Error('push failed'));

    render(<SettingsScreen />);

    fireEvent(
      screen.getByLabelText('Toggle push notifications'),
      'valueChange',
      true
    );

    await screen.findByTestId('toast-root');

    expect(mockToastError).toHaveBeenCalledWith(
      'Failed to update notification settings. Please try again.'
    );
  });

  it('shows a registration failure even when the hook resolves without throwing', () => {
    mockUsePushNotifications.mockReturnValue({
      isLoading: false,
      isRegistered: false,
      error: 'Failed to register token with server',
      register: mockRegisterPush,
      unregister: mockUnregisterPush,
    });

    render(<SettingsScreen />);

    expect(
      screen.getByText('Failed to register token with server')
    ).toBeOnTheScreen();
  });
});
