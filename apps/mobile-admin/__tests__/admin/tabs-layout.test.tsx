import { render, screen } from '@testing-library/react';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sourceError: null as 'checkout' | 'oxygen' | null,
  staffFollowUps: { data: {}, openOrders: [] } as {
    data?: Record<string, { stage: string }>;
    isError?: boolean;
    openOrders: { id: string; created_at: string }[];
  },
  failedOrders: [] as Array<{
    id: string;
    created_at: string;
    customer_email?: string;
  }>,
  oxygenOrders: [] as Array<{
    id: string;
    created_at: string;
    customer_email?: string;
  }>,
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

vi.mock('@/components/feedback/FeedbackLauncher', () => ({
  FeedbackLauncher: () => <div data-testid="feedback-launcher" />,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'viewer-1' } }),
}));
vi.mock('@/hooks/useStaffOrderFollowUps', () => ({
  useStaffOrderFollowUps: () => mocks.staffFollowUps,
}));

vi.mock('@/hooks/useFailedOrders', () => ({
  useFailedOrders: () => ({
    data: mocks.failedOrders,
    isError: mocks.sourceError === 'checkout',
  }),
}));
vi.mock('@/hooks/useOxygenFollowUps', () => ({
  useOxygenFollowUps: () => ({
    data: mocks.oxygenOrders,
    isError: mocks.sourceError === 'oxygen',
  }),
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
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

function getCustomersBadge() {
  return mocks.screens.find((screen) => screen.name === 'customers')?.options
    ?.tabBarBadge;
}

describe('TabLayout', () => {
  beforeEach(() => {
    mocks.sourceError = null;
    mocks.failedOrders = [];
    mocks.staffFollowUps = { data: {}, openOrders: [] };
    mocks.oxygenOrders = [];
    mocks.screens = [];
    mocks.tabsProps = null;
  });

  it('waits to count checkout rows until the closed status is known', () => {
    mocks.failedOrders = [
      { id: 'unknown', created_at: '2026-07-27T08:00:00Z' },
    ];
    mocks.staffFollowUps = { openOrders: [] };
    render(<TabLayout />);
    expect(getCustomersBadge()).toBeUndefined();
  });

  it.each([
    'staff',
    'checkout',
    'oxygen',
  ] as const)('warns when the %s feed fails', (source) => {
    mocks.failedOrders = [
      { id: 'unknown', created_at: '2026-07-27T08:00:00Z' },
    ];
    mocks.staffFollowUps = {
      data: {},
      openOrders: [],
      isError: source === 'staff',
    };
    mocks.sourceError = source === 'staff' ? null : source;
    render(<TabLayout />);
    expect(getCustomersBadge()).toBe('!');
  });

  it('counts open staff follow-ups and excludes closed drop-offs from the Customers badge', () => {
    mocks.failedOrders = [
      { id: 'closed-1', created_at: '2026-07-27T08:00:00Z' },
      { id: 'closed-2', created_at: '2026-07-27T08:00:00Z' },
    ];
    mocks.staffFollowUps = {
      data: {
        'closed-1': { stage: 'closed' },
        'closed-2': { stage: 'closed' },
      },
      openOrders: [{ id: 'retained-1', created_at: '2026-07-27T08:00:00Z' }],
    };
    render(<TabLayout />);
    expect(getCustomersBadge()).toBe(1);
  });

  it('keeps admin tabs retained and delegates rendering to the floating bar', () => {
    const { getByTestId } = render(<TabLayout />);

    expect(getByTestId('tabs-root')).toBeTruthy();
    expect(getByTestId('feedback-launcher')).toBeTruthy();

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
    mocks.failedOrders = [
      { id: 'dropoff-1', created_at: '2026-11-17T09:00:00Z' },
      { id: 'dropoff-2', created_at: '2026-11-17T08:00:00Z' },
    ];

    render(<TabLayout />);

    const ordersScreen = mocks.screens.find(
      (screen) => screen.name === 'orders'
    );
    expect(ordersScreen?.options?.tabBarBadge).toBeUndefined();
    expect(getCustomersBadge()).toBe(2);
  });

  it('counts Oxygen follow-ups without double-counting an order', () => {
    mocks.failedOrders = [{ id: 'same', created_at: '2026-11-17T09:00:00Z' }];
    mocks.oxygenOrders = [
      { id: 'same', created_at: '2026-11-17T09:00:00Z' },
      { id: 'oxygen', created_at: '2026-11-17T08:00:00Z' },
    ];
    render(<TabLayout />);
    expect(getCustomersBadge()).toBe(2);
  });

  it('counts distinct follow-up orders for the same email as separate queue entries', () => {
    mocks.failedOrders = [
      {
        id: 'standard',
        created_at: '2026-11-17T09:00:00Z',
        customer_email: 'ada@example.com',
      },
    ];
    mocks.oxygenOrders = [
      {
        id: 'oxygen',
        created_at: '2026-11-17T08:00:00Z',
        customer_email: 'ada@example.com',
      },
    ];
    render(<TabLayout />);
    expect(getCustomersBadge()).toBe(2);
  });

  it('shows a Customers badge for an Oxygen-only follow-up', () => {
    mocks.oxygenOrders = [{ id: 'oxygen', created_at: '2026-11-17T08:00:00Z' }];
    render(<TabLayout />);
    expect(getCustomersBadge()).toBe(1);
  });
});
