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
let mockDiscoveryBubbleVisible = true;

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

jest.mock('./WalletDiscoveryBubble', () => ({
  WalletDiscoveryBubble: ({
    homeFocused,
    onVisibilityChange,
  }: {
    homeFocused: boolean;
    onVisibilityChange: (visible: boolean) => void;
  }) => {
    const visible = homeFocused && mockDiscoveryBubbleVisible;
    jest
      .requireActual<typeof import('react')>('react')
      .useLayoutEffect(
        () => onVisibilityChange(visible),
        [onVisibilityChange, visible]
      );
    return visible
      ? jest
          .requireActual<typeof import('react')>('react')
          .createElement(
            jest.requireActual<typeof import('react-native')>('react-native')
              .View,
            { testID: 'wallet-discovery-bubble' }
          )
      : null;
  },
}));

describe('CustomTabBar', () => {
  let mockProps: BottomTabBarProps;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDiscoveryBubbleVisible = true;
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
          { key: 'wallet-key', name: 'wallet', params: {} },
          { key: 'hidden-key', name: 'categories', params: {} },
        ],
        type: 'tab',
        routeNames: ['index', 'saved', 'wallet', 'categories'],
        history: [],
        key: 'state-key',
        stale: false,
        preloadedRouteKeys: [],
      },
      descriptors: {
        'home-key': customTabBarTestUtils.createTabDescriptor('Home'),
        'saved-key': customTabBarTestUtils.createTabDescriptor('Saved'),
        'wallet-key': customTabBarTestUtils.createTabDescriptor('Wallet'),
        'hidden-key': customTabBarTestUtils.createHiddenDescriptor('Explore'),
      },
      navigation: {
        emit: jest.fn().mockReturnValue({ defaultPrevented: false }),
        dispatch: jest.fn(),
        navigate: jest.fn(),
      } as unknown as BottomTabBarProps['navigation'],
    };
  });

  it('renders visible tab items and ignores hidden routes', () => {
    render(<CustomTabBar {...mockProps} />);

    expect(screen.getByRole('tab', { name: 'Home' })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Saved' })).toBeOnTheScreen();
    expect(screen.queryByRole('tab', { name: 'Explore' })).toBeNull();
  });

  it('reserves touch space only while the discovery bubble is visible', () => {
    const { rerender } = render(<CustomTabBar {...mockProps} />);
    const wrapper = screen.getByTestId('custom-tab-bar-wrapper');
    expect(wrapper).not.toHaveStyle({ paddingTop: 96 });
    expect(screen.queryByTestId('wallet-discovery-bubble')).toBeNull();

    rerender(<CustomTabBar {...mockProps} preloadProtectedTabs />);
    expect(screen.getByTestId('wallet-discovery-bubble')).toBeOnTheScreen();
    expect(wrapper).toHaveStyle({ paddingTop: 96 });
    expect(screen.getByTestId('custom-tab-bar')).toHaveStyle({ height: 64 });

    mockDiscoveryBubbleVisible = false;
    rerender(<CustomTabBar {...mockProps} preloadProtectedTabs />);
    expect(screen.queryByTestId('wallet-discovery-bubble')).toBeNull();
    expect(wrapper).not.toHaveStyle({ paddingTop: 96 });

    mockDiscoveryBubbleVisible = true;
    rerender(
      <CustomTabBar
        {...mockProps}
        preloadProtectedTabs
        state={{ ...mockProps.state, index: 1 }}
      />
    );
    expect(screen.queryByTestId('wallet-discovery-bubble')).toBeNull();
    expect(wrapper).not.toHaveStyle({ paddingTop: 96 });
  });

  it('jumps immediately on press-in while rendering the moving capsule', () => {
    render(<CustomTabBar {...mockProps} />);

    expect(screen.getByTestId('custom-tab-bar-capsule')).toBeOnTheScreen();

    fireEvent(screen.getByRole('tab', { name: 'Saved' }), 'pressIn');
    fireEvent.press(screen.getByRole('tab', { name: 'Saved' }));

    expect(
      screen.getByRole('tab', { name: 'Saved' }).props.accessibilityState
    ).toEqual({ selected: true });
    customTabBarTestUtils.expectSavedTabPress(mockProps.navigation);
    expect(mockProps.navigation.navigate).not.toHaveBeenCalled();
    customTabBarTestUtils.expectSavedJumpDispatch(mockProps.navigation);
    expect(mockProps.navigation.dispatch).toHaveBeenCalledTimes(1);
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
        routeNames: ['index', 'saved', 'cart-tab', 'categories'],
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
        routeNames: ['index', 'saved', 'cart-tab', 'categories'],
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

    customTabBarTestUtils.expectSavedTabPress(mockProps.navigation);
    expect(mockProps.navigation.navigate).not.toHaveBeenCalled();
    customTabBarTestUtils.expectSavedJumpDispatch(mockProps.navigation);
  });

  it('does not navigate when tab press is prevented', () => {
    jest
      .mocked(mockProps.navigation.emit)
      .mockReturnValue({ defaultPrevented: true } as never);

    render(<CustomTabBar {...mockProps} />);

    fireEvent(screen.getByRole('tab', { name: 'Saved' }), 'pressIn');
    fireEvent.press(screen.getByRole('tab', { name: 'Saved' }));

    customTabBarTestUtils.expectSavedTabPress(mockProps.navigation);
    expect(mockProps.navigation.navigate).not.toHaveBeenCalled();
    expect(mockProps.navigation.dispatch).not.toHaveBeenCalled();
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
      .mocked(mockProps.navigation.emit)
      .mock.calls.filter(
        ([event]) =>
          (event as { type?: string }).type === 'tabPress' &&
          (event as { target?: string }).target === 'saved-key'
      );
    expect(tabPressCalls).toHaveLength(1);
    expect(mockProps.navigation.dispatch).toHaveBeenCalledTimes(1);
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
