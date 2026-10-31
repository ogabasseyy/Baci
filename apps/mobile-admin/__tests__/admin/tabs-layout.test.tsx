import { render, screen } from '@testing-library/react';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  failedOrders: [] as Array<{ id: string }>,
  screens: [] as Array<{
    name: string;
    options?: Record<string, unknown>;
  }>,
  tabsProps: null as null | Record<string, unknown>,
}));

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    StatusBar: () => null,
    StyleSheet: {
      create: <T,>(styles: T) => styles,
    },
    View: ({
      children,
      style,
      testID,
    }: {
      children?: React.ReactNode;
      style?: unknown;
      testID?: string;
    }) =>
      React.createElement(
        'div',
        {
          'data-style': JSON.stringify(style),
          'data-testid': testID,
        },
        children
      ),
  };
});

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,

  default: () => null,
  __esModule: true,
}));

vi.mock('@/components/navigation/AdminFloatingTabBar', async () => {
  const React = await import('react');

  return {
    AdminFloatingTabBar: () =>
      React.createElement('div', {
        'data-testid': 'admin-floating-tab-bar-mock',
      }),
  };
});

vi.mock('expo-router', async () => {
  const React = await import('react');

  const Tabs = ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => {
    mocks.tabsProps = props;
    return React.createElement('div', { 'data-testid': 'tabs-root' }, children);
  };

  Tabs.Screen = ({
    name,
    options,
  }: {
    name: string;
    options?: Record<string, unknown>;
  }) => {
    mocks.screens.push({ name, options });
    return null;
  };

  return { Tabs };
});

vi.mock('@/hooks/useFailedOrders', () => ({
  useFailedOrders: () => ({ data: mocks.failedOrders }),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#e5e7eb',
      card: '#ffffff',
      goldLight: '#fef3c7',
      primary: '#2563eb',
      textSecondary: '#64748b',
    },
  }),
}));

import TabLayout, { unstable_settings } from '@/app/(admin)/(tabs)/_layout';

type TabBarRenderer = (props: BottomTabBarProps) => React.ReactNode;

describe('TabLayout', () => {
  beforeEach(() => {
    mocks.failedOrders = [];
    mocks.screens = [];
    mocks.tabsProps = null;
  });

  it('keeps admin tabs retained and delegates rendering to the floating bar', () => {
    const { getByTestId } = render(<TabLayout />);

    expect(getByTestId('tabs-root')).toBeTruthy();

    const screenOptions = mocks.tabsProps?.screenOptions as {
      freezeOnBlur: boolean;
      lazy: boolean;
      tabBarHideOnKeyboard: boolean;
      tabBarShowLabel: boolean;
    };
    expect(screenOptions).toBeDefined();

    expect(mocks.tabsProps?.detachInactiveScreens).toBe(false);
    expect(mocks.tabsProps?.initialRouteName).toBeUndefined();
    expect(unstable_settings.initialRouteName).toBe('index');
    expect(typeof mocks.tabsProps?.tabBar).toBe('function');
    const tabBar = mocks.tabsProps?.tabBar as TabBarRenderer;
    render(
      tabBar({
        descriptors: {},
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
        emitter: {} as BottomTabBarProps['emitter'],
        navigateToTab: vi.fn(),
        state: {
          index: 0,
          routes: [],
        },
      })
    );
    expect(screen.getByTestId('admin-floating-tab-bar-mock')).toBeTruthy();
    expect(screenOptions.freezeOnBlur).toBe(false);
    expect(screenOptions.lazy).toBe(true);
    expect(screenOptions.tabBarHideOnKeyboard).toBe(true);
    expect(screenOptions.tabBarShowLabel).toBe(true);

    const shellStyle =
      getByTestId('tab-shell').getAttribute('data-style') ?? '';
    expect(shellStyle).not.toContain('marginBottom');
  });

  it('places follow-up badges on Customers instead of Orders', () => {
    mocks.failedOrders = [{ id: 'dropoff-1' }, { id: 'dropoff-2' }];

    render(<TabLayout />);

    const ordersScreen = mocks.screens.find(
      (screen) => screen.name === 'orders'
    );
    const customersScreen = mocks.screens.find(
      (screen) => screen.name === 'customers'
    );

    expect(ordersScreen?.options?.tabBarBadge).toBeUndefined();
    expect(customersScreen?.options?.tabBarBadge).toBe(2);
  });
});
