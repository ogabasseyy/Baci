import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type React from 'react';
import {
  type StyleProp,
  StyleSheet,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import TabLayout from '@/app/(tabs)/_layout';

const MockText = Text;
const MockView = View;
const mockThemeColors = {
  background: '#101010',
  border: '#333333',
  card: '#202020',
  mutedForeground: '#999999',
  primary: '#2563eb',
  primaryForeground: '#f8fafc',
  selectedIconBackground: '#303030',
  tabIconDefault: '#888888',
  tabIconSelected: '#ffffff',
  text: '#f5f5f5',
};
const mockSafeAreaInsets = {
  top: 59,
  right: 0,
  bottom: 34,
  left: 0,
};
type MockTabBarIconOptions = {
  focused: boolean;
  color: string;
  size: number;
};
type MockTabBarLabelOptions = {
  focused: boolean;
  color: string;
  children: string;
  position: 'below-icon' | 'beside-icon';
};
type MockTabsScreenProps = {
  listeners?: {
    tabPress?: (event: { preventDefault: () => void }) => void;
  };
  name: string;
  options?: {
    freezeOnBlur?: boolean;
    headerShown?: boolean;
    tabBarIcon?: (options: MockTabBarIconOptions) => React.ReactNode;
    tabBarLabel?: (options: MockTabBarLabelOptions) => React.ReactNode;
  };
};
type MockTabsProps = {
  children?: React.ReactNode;
  detachInactiveScreens?: boolean;
  screenOptions?: {
    freezeOnBlur?: boolean;
    headerStyle?: ViewStyle;
    headerTintColor?: string;
    tabBarActiveTintColor?: string;
    tabBarInactiveTintColor?: string;
    tabBarStyle?: ViewStyle;
    lazy?: boolean;
  };
  tabBar?: (props: unknown) => React.ReactNode;
};

const mockTabsScreen = jest.fn(({ name, options }: MockTabsScreenProps) => (
  <MockView>
    <MockText
      accessibilityLabel={`${name} screen header ${
        options?.headerShown === false ? 'hidden' : 'shown'
      }`}
    >
      {name}
    </MockText>
    {options?.tabBarIcon?.({ focused: true, color: '#000000', size: 22 })}
    {options?.tabBarLabel?.({
      focused: true,
      color: '#000000',
      children: name,
      position: 'below-icon',
    })}
  </MockView>
));
const mockTabs = jest.fn(
  ({ children, screenOptions, tabBar }: MockTabsProps) => (
    <MockView
      testID="tabs-root"
      accessibilityLabel="tabs root"
      style={screenOptions?.tabBarStyle}
    >
      {children}
      {tabBar?.({})}
    </MockView>
  )
);
const mockRouterPush = jest.fn();

jest.mock('@/components/navigation/CustomTabBar', () => ({
  CustomTabBar: () => (
    <MockView testID="custom-tab-bar" accessibilityLabel="custom tab bar" />
  ),
}));

jest.mock('@react-native-vector-icons/ionicons', () => {
  const { Text: MockIconText } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    Ionicons: ({
      color,
      name,
      style,
    }: {
      color: string;
      name: string;
      style?: StyleProp<TextStyle>;
    }) => (
      <MockIconText testID={`tab-icon-${name}`} style={[style, { color }]}>
        {name}
      </MockIconText>
    ),

    default: ({
      color,
      name,
      style,
    }: {
      color: string;
      name: string;
      style?: StyleProp<TextStyle>;
    }) => (
      <MockIconText
        testID={`tab-icon-${name}`}
        style={[
          style,
          {
            color,
          },
        ]}
      >
        {name}
      </MockIconText>
    ),
    __esModule: true,
  };
});

jest.mock('expo-router', () => {
  const Tabs = (props: MockTabsProps) => mockTabs(props);

  Tabs.Screen = (props: MockTabsScreenProps) => mockTabsScreen(props);

  return {
    Tabs,
    router: {
      push: (...args: unknown[]) => mockRouterPush(...args),
    },
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockSafeAreaInsets,
}));

jest.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(selector: T) => selector,
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: (selector: (state: { itemCount: () => number }) => unknown) =>
    selector({ itemCount: () => 2 }),
}));

jest.mock('@/stores/saved-store', () => ({
  useSavedStore: (selector: (state: { items: unknown[] }) => unknown) =>
    selector({ items: [{ id: 'saved-1' }] }),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: {
      isInitialized: boolean;
      user: { id: string } | null;
    }) => unknown
  ) =>
    selector({
      isInitialized: true,
      user: { id: 'user-1' },
    }),
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: mockThemeColors,
    isDark: true,
    shadows: {},
  }),
}));

// Side-effect-only warm hook (needs QueryClientProvider in prod, which these
// structure tests don't mount); the hook itself is covered by its own suite.
jest.mock('@/hooks/use-warm-merchant-payment-settings', () => ({
  useWarmMerchantPaymentSettings: jest.fn(),
}));

jest.mock('@/lib/templates', () => ({
  getTemplateConfig: () => ({
    headerStyle: 'standard',
    heroVariant: 'standard',
    categoryStyle: 'pill',
    cardVariant: 'grid',
    spacing: 'compact',
    borderRadius: 'md',
  }),
}));

describe('TabLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the tab navigator without wrapping it in a notch-shifting shell', () => {
    render(<TabLayout />);

    expect(screen.getByLabelText('tabs root')).toBeOnTheScreen();
  });

  it('delegates bottom tab sizing to the custom tab bar without offsetting the tabs root', () => {
    render(<TabLayout />);

    const tabsRootStyle = StyleSheet.flatten(
      screen.getByLabelText('tabs root').props.style
    );

    expect(tabsRootStyle).toBeUndefined();
    expect(screen.getByLabelText('custom tab bar')).toBeOnTheScreen();
  });

  it('uses the cart tab as a real warmed tab screen with its header hidden', () => {
    render(<TabLayout />);

    const cartTabProps = mockTabsScreen.mock.calls.find(
      ([props]) => props.name === 'cart-tab'
    )?.[0];

    expect(
      screen.getByLabelText('cart-tab screen header hidden')
    ).toBeOnTheScreen();
    expect(cartTabProps?.listeners?.tabPress).toBeUndefined();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('uses theme colors for the tab chrome while preserving badge contrast', () => {
    render(<TabLayout />);

    const tabsProps = mockTabs.mock.calls.at(-1)?.[0];
    const homeScreenProps = mockTabsScreen.mock.calls.find(
      ([props]) => props.name === 'index'
    )?.[0];
    const cartBadgeText = screen.getByText('2');
    const cartBadgeTextStyle = StyleSheet.flatten(cartBadgeText.props.style);
    const cartBadge = screen.UNSAFE_getAllByType(View).find((node) => {
      const style = StyleSheet.flatten(node.props.style);
      return style?.backgroundColor === mockThemeColors.primary;
    });
    const cartBadgeStyle = StyleSheet.flatten(
      cartBadge?.props.style as StyleProp<ViewStyle>
    );

    expect(tabsProps?.screenOptions).toMatchObject({
      freezeOnBlur: true,
      headerStyle: {
        backgroundColor: mockThemeColors.background,
      },
      headerTintColor: mockThemeColors.text,
      tabBarActiveTintColor: mockThemeColors.text,
      tabBarInactiveTintColor: mockThemeColors.mutedForeground,
      lazy: true,
    });
    expect(tabsProps?.detachInactiveScreens).toBe(true);
    expect(homeScreenProps?.options?.freezeOnBlur).toBe(true);
    expect(cartBadgeStyle).toMatchObject({
      backgroundColor: mockThemeColors.primary,
      borderColor: mockThemeColors.card,
    });
    expect(cartBadgeTextStyle).toMatchObject({
      color: mockThemeColors.primaryForeground,
    });
  });
});
