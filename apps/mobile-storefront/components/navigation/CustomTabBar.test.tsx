import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Platform } from 'react-native';
import { CustomTabBar } from './CustomTabBar';
import { customTabBarTestUtils } from './CustomTabBar.test-utils';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: {
    Light: 'light',
  },
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      text: '#000000',
      tabIconDefault: '#cccccc',
      tabIconSelected: '#ff0000',
      selectedIconBackground: 'rgba(220, 38, 38, 0.08)',
      primary: '#ff0000',
      card: '#ffffff',
      primaryForeground: '#ffffff',
    },
    isDark: false,
  }),
}));

const mockUseColorScheme = jest.fn(() => 'light');

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => mockUseColorScheme(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockUseKeyboard = jest.fn(() => ({
  dismissKeyboard: jest.fn(),
  isKeyboardVisible: false,
  keyboardHeight: 0,
  withKeyboardDismiss: <T extends (...args: never[]) => unknown>(handler: T) =>
    handler,
}));

jest.mock('@/hooks/use-keyboard', () => ({
  useKeyboard: () => mockUseKeyboard(),
}));

describe('CustomTabBar', () => {
  let mockProps: BottomTabBarProps;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseKeyboard.mockReturnValue({
      dismissKeyboard: jest.fn(),
      isKeyboardVisible: false,
      keyboardHeight: 0,
      withKeyboardDismiss: <T extends (...args: never[]) => unknown>(
        handler: T
      ) => handler,
    });

    mockProps = {
      insets: { top: 0, bottom: 0, left: 0, right: 0 },
      state: {
        index: 0,
        routes: [
          { key: 'home-key', name: 'index', params: {} },
          { key: 'saved-key', name: 'saved', params: {} },
          { key: 'hidden-key', name: 'categories', params: {} },
        ],
      },
      descriptors: {
        'home-key': customTabBarTestUtils.createTabDescriptor('Home'),
        'saved-key': customTabBarTestUtils.createTabDescriptor('Saved'),
        'hidden-key': customTabBarTestUtils.createHiddenDescriptor('Explore'),
      },
      navigateToTab: jest.fn(),
      emitter: {
        emit: jest.fn().mockReturnValue({ defaultPrevented: false }),
      } as unknown as BottomTabBarProps['emitter'],
    };
  });

  it('renders visible tab items and ignores hidden routes', () => {
    render(<CustomTabBar {...mockProps} />);

    expect(screen.getByRole('tab', { name: 'Home' })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Saved' })).toBeOnTheScreen();
    expect(screen.queryByRole('tab', { name: 'Explore' })).toBeNull();
  });

  it('jumps immediately on press-in while rendering the moving capsule', () => {
    render(<CustomTabBar {...mockProps} />);

    expect(screen.getByTestId('custom-tab-bar-capsule')).toBeOnTheScreen();

    fireEvent(screen.getByRole('tab', { name: 'Saved' }), 'pressIn');
    fireEvent.press(screen.getByRole('tab', { name: 'Saved' }));

    expect(
      screen.getByRole('tab', { name: 'Saved' }).props.accessibilityState
    ).toEqual({ selected: true });
    customTabBarTestUtils.expectSavedTabPress(mockProps);
    customTabBarTestUtils.expectSavedJumpDispatch(mockProps);
    expect(mockProps.navigateToTab).toHaveBeenCalledTimes(1);
  });

  it('renders the cart tab when another route is active', () => {
    const cartProps: BottomTabBarProps = {
      ...mockProps,
      state: {
        ...mockProps.state,
        index: 0,
        routes: [
          mockProps.state.routes[0],
          mockProps.state.routes[1],
          { key: 'cart-key', name: 'cart-tab', params: {} },
          mockProps.state.routes[2],
        ],
      },
      descriptors: {
        ...mockProps.descriptors,
        'cart-key': customTabBarTestUtils.createTabDescriptor('Cart'),
      },
    };

    render(<CustomTabBar {...cartProps} />);

    expect(screen.getByRole('tab', { name: 'Cart' })).toBeOnTheScreen();
  });

  it('hides the floating tab bar while the cart route is active', () => {
    const cartProps: BottomTabBarProps = {
      ...mockProps,
      state: {
        ...mockProps.state,
        index: 2,
        routes: [
          mockProps.state.routes[0],
          mockProps.state.routes[1],
          { key: 'cart-key', name: 'cart-tab', params: {} },
          mockProps.state.routes[2],
        ],
      },
      descriptors: {
        ...mockProps.descriptors,
        'cart-key': customTabBarTestUtils.createTabDescriptor('Cart'),
      },
    };

    const { toJSON } = render(<CustomTabBar {...cartProps} />);

    expect(toJSON()).toBeNull();
  });

  it('hides the floating tab bar while the keyboard is visible', () => {
    mockUseKeyboard.mockReturnValue({
      dismissKeyboard: jest.fn(),
      isKeyboardVisible: true,
      keyboardHeight: 320,
      withKeyboardDismiss: <T extends (...args: never[]) => unknown>(
        handler: T
      ) => handler,
    });

    const { toJSON } = render(<CustomTabBar {...mockProps} />);

    expect(toJSON()).toBeNull();
  });

  it('navigates to selected tab when pressed', () => {
    render(<CustomTabBar {...mockProps} />);

    fireEvent.press(screen.getByRole('tab', { name: 'Saved' }));

    customTabBarTestUtils.expectSavedTabPress(mockProps);
    customTabBarTestUtils.expectSavedJumpDispatch(mockProps);
  });

  it('does not navigate when tab press is prevented', () => {
    jest
      .mocked(mockProps.emitter.emit)
      .mockReturnValue({ defaultPrevented: true } as never);

    render(<CustomTabBar {...mockProps} />);

    fireEvent(screen.getByRole('tab', { name: 'Saved' }), 'pressIn');
    fireEvent.press(screen.getByRole('tab', { name: 'Saved' }));

    customTabBarTestUtils.expectSavedTabPress(mockProps);
    expect(mockProps.navigateToTab).not.toHaveBeenCalled();
  });

  it('emits a single tabPress when pressOut fires before press', () => {
    // Regression: RN fires onPressOut before onPress. If pressOut cleared the
    // press-in guard, onPress would re-commit → tabPress twice (e.g. the auth
    // listener pushing /auth/login twice). The guard must survive pressOut.
    render(<CustomTabBar {...mockProps} />);

    const saved = screen.getByRole('tab', { name: 'Saved' });
    fireEvent(saved, 'pressIn');
    fireEvent(saved, 'pressOut');
    fireEvent.press(saved);

    const tabPressCalls = jest
      .mocked(mockProps.emitter.emit)
      .mock.calls.filter(
        ([event]) =>
          (event as { type?: string }).type === 'tabPress' &&
          (event as { target?: string }).target === 'saved-key'
      );
    expect(tabPressCalls).toHaveLength(1);
    expect(mockProps.navigateToTab).toHaveBeenCalledTimes(1);
  });

  it('triggers haptics on tab press-in when platform is not web', () => {
    const originalOS = Platform.OS;
    Platform.OS = 'ios';
    try {
      render(<CustomTabBar {...mockProps} />);

      fireEvent(screen.getByRole('tab', { name: 'Saved' }), 'pressIn');

      expect(Haptics.impactAsync).toHaveBeenCalledWith(
        Haptics.ImpactFeedbackStyle.Light
      );
    } finally {
      Platform.OS = originalOS;
    }
  });
});
