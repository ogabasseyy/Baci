import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminFloatingTabBar } from './AdminFloatingTabBar';

const navigationMocks = vi.hoisted(() => ({
  scrollAdminTabToTop: vi.fn(),
  useWarmAdminTabScreens: vi.fn(),
}));

vi.mock('@/lib/admin-tab-scroll-to-top', () => ({
  scrollAdminTabToTop: navigationMocks.scrollAdminTabToTop,
}));

vi.mock('./useWarmAdminTabScreens', () => ({
  useWarmAdminTabScreens: navigationMocks.useWarmAdminTabScreens,
}));

vi.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: {
    Light: 'light',
  },
  impactAsync: vi.fn(),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      gold: '#D4A03D',
      goldLight: 'rgba(212, 160, 61, 0.12)',
      notification: '#DC2626',
      primary: '#3B82F6',
      primaryLight: 'rgba(59, 130, 246, 0.1)',
      textOnNotification: '#FFFFFF',
      textSecondary: '#64748B',
    },
    isDark: false,
  }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

vi.mock('react-native-reanimated', () => {
  return {
    Easing: {
      bezier: () => 'bezier-easing',
    },
    default: {
      View: ({
        accessibilityRole,
        children,
        pointerEvents,
        style,
        testID,
      }: {
        accessibilityRole?: string;
        children?: ReactNode;
        pointerEvents?: string;
        style?: unknown;
        testID?: string;
      }) => (
        <div
          data-pointer-events={pointerEvents}
          data-style={JSON.stringify(style)}
          data-testid={testID}
          role={accessibilityRole === 'tablist' ? 'tablist' : undefined}
        >
          {children}
        </div>
      ),
    },
    cancelAnimation: vi.fn(),
    runOnUI: (worklet: (...args: unknown[]) => void) => worklet,
    useAnimatedStyle: (callback: () => object) => callback(),
    useSharedValue: (value: number) => ({ value }),
    withSpring: (value: number) => ({ type: 'spring', value }),
    withTiming: (value: number) => ({ type: 'timing', value }),
  };
});

vi.mock('react-native', () => {
  return {
    StatusBar: () => null,
    Platform: {
      OS: 'web',
    },
    Pressable: ({
      accessibilityLabel,
      accessibilityRole,
      children,
      onPress,
      onPressIn,
      onPressOut,
      testID,
    }: {
      accessibilityLabel?: string;
      accessibilityRole?: string;
      accessibilityState?: { selected?: boolean };
      children?: ReactNode;
      hitSlop?: unknown;
      onPress?: () => void;
      onPressIn?: () => void;
      onPressOut?: () => void;
      style?: unknown;
      testID?: string;
    }) => (
      <button
        aria-label={accessibilityLabel}
        data-testid={testID}
        onClick={() => onPress?.()}
        onMouseDown={() => onPressIn?.()}
        onMouseUp={() => onPressOut?.()}
        role={accessibilityRole === 'tab' ? 'tab' : undefined}
        type="button"
      >
        {children}
      </button>
    ),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({ children }: { children?: ReactNode; style?: unknown }) => (
      <span>{children}</span>
    ),
    useWindowDimensions: () => ({ height: 844, width: 390 }),
    View: ({
      accessibilityRole,
      children,
      pointerEvents,
      style,
      testID,
    }: {
      accessibilityRole?: string;
      children?: ReactNode;
      pointerEvents?: string;
      style?: unknown;
      testID?: string;
    }) => (
      <div
        data-pointer-events={pointerEvents}
        data-style={JSON.stringify(style)}
        data-testid={testID}
        role={accessibilityRole === 'tablist' ? 'tablist' : undefined}
      >
        {children}
      </div>
    ),
  };
});

function getRenderedElementStyle(element: Element) {
  const styleAttribute = element.getAttribute('data-style');
  return styleAttribute ? JSON.parse(styleAttribute) : null;
}

function getRenderedChildStyles(testID: string) {
  return Array.from(screen.getByTestId(testID).querySelectorAll('[data-style]'))
    .map((element) => element.getAttribute('data-style'))
    .filter((styleAttribute): styleAttribute is string =>
      Boolean(styleAttribute)
    )
    .map((styleAttribute) => JSON.parse(styleAttribute));
}

function styleContains(
  style: unknown,
  expected: Record<string, unknown>
): boolean {
  if (Array.isArray(style)) {
    return style.some((entry) => styleContains(entry, expected));
  }

  if (!style || typeof style !== 'object') {
    return false;
  }

  return Object.entries(expected).every(
    ([key, value]) => (style as Record<string, unknown>)[key] === value
  );
}

function createProps(focusedIndex = 0): BottomTabBarProps {
  const routes = [
    { key: 'index-key', name: 'index', params: {} },
    { key: 'orders-key', name: 'orders', params: { status: 'open' } },
    { key: 'products-key', name: 'products', params: {} },
    { key: 'customers-key', name: 'customers', params: {} },
    { key: 'menu-key', name: 'menu', params: {} },
    { key: 'inventory-key', name: 'inventory', params: {} },
    { key: 'settings-key', name: 'settings', params: {} },
  ];

  return {
    descriptors: {
      'index-key': {
        options: {
          tabBarIcon: () => <span data-testid="home-icon" />,
          title: 'Home',
        },
      },
      'inventory-key': {
        options: { href: null, title: 'Inventory' },
      },
      'customers-key': {
        options: {
          tabBarIcon: () => <span data-testid="customers-icon" />,
          title: 'Customers',
        },
      },
      'menu-key': {
        options: {
          tabBarIcon: () => <span data-testid="menu-icon" />,
          title: 'Menu',
        },
      },
      'orders-key': {
        options: {
          tabBarBadge: 2,
          tabBarIcon: () => <span data-testid="orders-icon" />,
          title: 'Orders',
        },
      },
      'products-key': {
        options: {
          tabBarIcon: () => <span data-testid="products-icon" />,
          title: 'Products',
        },
      },
      'settings-key': {
        options: {},
      },
    },
    insets: { bottom: 34, left: 0, right: 0, top: 0 },
    navigation: {
      dispatch: vi.fn(),
      emit: vi.fn(() => ({ defaultPrevented: false })),
    },
    state: {
      history: [],
      index: focusedIndex,
      key: 'admin-tabs-key',
      routeNames: routes.map((route) => route.name),
      routes,
      type: 'tab',
    },
  } as unknown as BottomTabBarProps;
}

describe('AdminFloatingTabBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders visible tabs and hides href-null routes', () => {
    render(<AdminFloatingTabBar {...createProps()} />);

    expect(screen.getByRole('tab', { name: 'Home' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Orders' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Products' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Customers' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Menu' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Inventory' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'settings' })).toBeNull();
    expect(screen.getByText('2')).toBeTruthy();
    expect(navigationMocks.useWarmAdminTabScreens).toHaveBeenCalledWith(
      expect.objectContaining({
        activeRouteName: 'index',
        routes: expect.arrayContaining([
          expect.objectContaining({ name: 'orders' }),
        ]),
      })
    );
  });

  it('floats as a transparent overlay instead of painting a footer behind the bar', () => {
    render(<AdminFloatingTabBar {...createProps()} />);

    const wrapperStyle = getRenderedElementStyle(screen.getByRole('tablist'));

    expect(
      styleContains(wrapperStyle, {
        backgroundColor: 'transparent',
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
      })
    ).toBe(true);
  });

  it('lets touches outside the floating bar pass through the transparent overlay', () => {
    render(<AdminFloatingTabBar {...createProps()} />);

    expect(screen.getByRole('tablist')).toHaveAttribute(
      'data-pointer-events',
      'box-none'
    );
  });

  it('does not render the thin glass highlight strip over the tab bar', () => {
    render(<AdminFloatingTabBar {...createProps()} />);

    const childStyles = getRenderedChildStyles('admin-floating-tab-bar');

    expect(
      childStyles.some((style) =>
        styleContains(style, {
          height: 16,
          left: 14,
          right: 14,
          top: 2,
        })
      )
    ).toBe(false);
  });

  it('jumps to the pressed tab immediately on press-in', () => {
    const props = createProps();
    globalThis.requestAnimationFrame = vi.fn();

    render(<AdminFloatingTabBar {...props} />);

    const ordersTab = screen.getByRole('tab', { name: 'Orders' });
    fireEvent.mouseDown(ordersTab);
    fireEvent.click(ordersTab);

    expect(props.navigation.dispatch).toHaveBeenCalledWith({
      payload: { name: 'orders', params: { status: 'open' } },
      target: 'admin-tabs-key',
      type: 'JUMP_TO',
    });
    expect(props.navigation.dispatch).toHaveBeenCalledTimes(1);
    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('keeps the press-in marker through press-out so press can consume it', () => {
    const props = createProps();

    render(<AdminFloatingTabBar {...props} />);

    const ordersTab = screen.getByRole('tab', { name: 'Orders' });
    fireEvent.mouseDown(ordersTab);
    fireEvent.mouseUp(ordersTab);
    fireEvent.click(ordersTab);

    expect(props.navigation.dispatch).toHaveBeenCalledTimes(1);
  });

  it('does not scroll on one press of the focused tab', () => {
    render(<AdminFloatingTabBar {...createProps()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));
    expect(navigationMocks.scrollAdminTabToTop).not.toHaveBeenCalled();
  });

  it('scrolls after a focused tab is pressed twice quickly', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(100);
    render(<AdminFloatingTabBar {...createProps()} />);
    const homeTab = screen.getByRole('tab', { name: 'Home' });

    fireEvent.click(homeTab);
    now.mockReturnValue(300);
    fireEvent.click(homeTab);

    expect(navigationMocks.scrollAdminTabToTop).toHaveBeenCalledOnce();
    expect(navigationMocks.scrollAdminTabToTop).toHaveBeenCalledWith('index');
    now.mockRestore();
  });

  it('bugfix: counts pressIn tab-switch as first double-tap press', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(100);
    const { rerender } = render(<AdminFloatingTabBar {...createProps()} />);
    const ordersTab = screen.getByRole('tab', { name: 'Orders' });

    fireEvent.mouseDown(ordersTab);
    fireEvent.click(ordersTab);

    rerender(<AdminFloatingTabBar {...createProps(1)} />);
    now.mockReturnValue(300);
    fireEvent.click(screen.getByRole('tab', { name: 'Orders' }));

    expect(navigationMocks.scrollAdminTabToTop).toHaveBeenCalledOnce();
    expect(navigationMocks.scrollAdminTabToTop).toHaveBeenCalledWith('orders');
    now.mockRestore();
  });

  it('does not scroll when the second focused press is too late', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(100);
    render(<AdminFloatingTabBar {...createProps()} />);
    const homeTab = screen.getByRole('tab', { name: 'Home' });

    fireEvent.click(homeTab);
    now.mockReturnValue(451);
    fireEvent.click(homeTab);

    expect(navigationMocks.scrollAdminTabToTop).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it('does not scroll when the second press targets a different tab', () => {
    render(<AdminFloatingTabBar {...createProps()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Orders' }));
    expect(navigationMocks.scrollAdminTabToTop).not.toHaveBeenCalled();
  });
});
