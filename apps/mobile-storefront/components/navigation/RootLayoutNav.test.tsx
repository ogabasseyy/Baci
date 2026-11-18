import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import type React from 'react';
import { Platform, Text, View } from 'react-native';
import { useStartupMotionEnabled } from '@/components/ui/useStartupMotionEnabled';
import { CHAT_WIDGET_DEFAULT_BOTTOM_OFFSET } from '@/constants/layout';
import { getTemplateConfig } from '@/lib/templates';
import { registerRootLayoutNavStartupTests } from '@/test-support/root-layout-nav-startup-test-cases';
import { RootLayoutNav } from './RootLayoutNav';

const mockGetTemplateConfig = getTemplateConfig as jest.MockedFunction<
  typeof getTemplateConfig
>;

const MockText = Text;
const MockView = View;
const mockUseAuthGuard = jest.fn();
const mockSetNavigationBarStyle = jest.fn();
const mockRootStackOptions = jest.fn();
let mockRootNavigationState: { key: string } | undefined = { key: 'root' };
const originalPlatformOS = Platform.OS;
function StartupMotionProbe() {
  const enabled = useStartupMotionEnabled();
  return <Text>{enabled ? 'startup-motion:on' : 'startup-motion:off'}</Text>;
}
const renderMockQueryProvider = ({
  children,
  persistenceEnabled,
}: {
  children?: React.ReactNode;
  persistenceEnabled?: boolean;
}) => (
  <View>
    <StartupMotionProbe />
    <Text>{persistenceEnabled ? 'persist:on' : 'persist:off'}</Text>
    {children}
  </View>
);
const mockQueryProvider = jest.fn(renderMockQueryProvider);

jest.mock('expo-router/react-navigation', () => ({
  DarkTheme: { colors: {} },
  DefaultTheme: { colors: {} },
  ThemeProvider: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock('expo-router', () => {
  const Stack = ({
    children,
    screenOptions,
  }: {
    children?: React.ReactNode;
    screenOptions?: unknown;
  }) => {
    mockRootStackOptions(screenOptions);
    return (
      <MockView
        accessibilityLabel="root stack"
        accessibilityRole="summary"
        accessible
        testID="root-stack"
      >
        {children}
      </MockView>
    );
  };

  Stack.Screen = ({ name }: { name: string }) => <MockText>{name}</MockText>;

  return {
    router: { replace: jest.fn() },
    Stack,
    useGlobalSearchParams: () => ({}),
    useSegments: () => [],
    usePathname: () => '/',
    useRootNavigationState: () => mockRootNavigationState,
  };
});

jest.mock('expo-navigation-bar', () => ({
  setStyle: (...args: unknown[]) => mockSetNavigationBarStyle(...args),
}));

function setPlatformOS(value: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value,
  });
}

jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children }: { children?: React.ReactNode }) => {
    return <MockView>{children}</MockView>;
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => (
    <MockView testID="safe-area-provider">{children}</MockView>
  ),
}));

jest.mock('@/components/updates/MobileUpdateController', () => ({
  MobileUpdateController: () => <MockText>update-controller</MockText>,
}));

jest.mock('@/components/cart/SharedCartBridge', () => ({
  SharedCartBridge: () => <MockText>shared-cart-bridge</MockText>,
}));
jest.mock('@/components/cart/CartWriteNotice', () => ({
  CartWriteNotice: () => <MockText>cart-write-notice</MockText>,
}));
jest.mock('@/components/cart/NativeCartPairingPanel', () => ({
  NativeCartPairingPanel: () => <MockText>cart-pairing-panel</MockText>,
}));

jest.mock('@/components/ConnectivityBanner', () => ({
  ConnectivityBanner: () => <MockText>connectivity-banner</MockText>,
}));

jest.mock('@/components/chat/ChatWidget', () => ({
  ChatWidget: ({ bottomOffset }: { bottomOffset: number }) => (
    <MockText>{`chat-widget:${bottomOffset}`}</MockText>
  ),
}));

jest.mock('@/components/ErrorBoundary', () => ({
  GlobalErrorBoundary: ({
    children,
  }: {
    children?: React.ReactNode;
    context: string;
  }) => children,
}));

jest.mock('@/components/modals/NegotiationModal', () => ({
  NegotiationModal: () => <MockText>negotiation-modal</MockText>,
}));

jest.mock('@/components/navigation/DrawerMenu', () => ({
  DrawerMenu: () => <MockText>drawer-menu</MockText>,
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/lib/templates', () => ({
  getTemplateConfig: jest.fn(() => ({
    headerStyle: 'standard',
    heroVariant: 'standard',
    categoryStyle: 'pill',
    cardVariant: 'grid',
    spacing: 'compact',
    borderRadius: 'md',
    features: {
      connectivityBanner: true,
      chatWidget: true,
      negotiationModal: true,
      drawerMenu: true,
    },
  })),
}));

jest.mock('@/hooks/use-auth-guard', () => ({
  useAuthGuard: () => mockUseAuthGuard(),
}));

jest.mock('@/lib/QueryProvider', () => ({
  QueryProvider: (props: {
    children?: React.ReactNode;
    persistenceEnabled?: boolean;
  }) => mockQueryProvider(props),
}));

describe('RootLayoutNav', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryProvider.mockImplementation(renderMockQueryProvider);
    mockRootNavigationState = { key: 'root' };
    setPlatformOS(originalPlatformOS);
  });

  afterEach(() => {
    setPlatformOS(originalPlatformOS);
  });

  registerRootLayoutNavStartupTests({ RootLayoutNav });

  it('waits for router readiness after the shell lays out before reporting startup layout', async () => {
    mockRootNavigationState = undefined;
    const onFirstLayout = jest.fn();
    const view = render(<RootLayoutNav onFirstLayout={onFirstLayout} />);
    fireEvent(view.getByTestId('root-app-shell'), 'layout');

    expect(onFirstLayout).not.toHaveBeenCalled();

    mockRootNavigationState = { key: 'root' };
    view.rerender(<RootLayoutNav onFirstLayout={onFirstLayout} />);

    await waitFor(() => expect(onFirstLayout).toHaveBeenCalledTimes(1));
  });

  it('asks the native stack to suspend covered routes while checkout or a product is active', () => {
    render(<RootLayoutNav />);

    expect(mockRootStackOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ freezeOnBlur: true })
    );
  });

  it('renders the storefront navigator and startup overlays', () => {
    render(<RootLayoutNav />);

    expect(screen.getByRole('summary', { name: 'root stack' })).toBeTruthy();
    expect(screen.getByText('(tabs)')).toBeTruthy();
    expect(screen.getByText('checkout')).toBeTruthy();
    expect(screen.getByText('connectivity-banner')).toBeTruthy();
    expect(
      screen.getByText(`chat-widget:${CHAT_WIDGET_DEFAULT_BOTTOM_OFFSET}`)
    ).toBeTruthy();
    expect(screen.getByText('negotiation-modal')).toBeTruthy();
    expect(screen.getByText('drawer-menu')).toBeTruthy();
    expect(mockUseAuthGuard).toHaveBeenCalledTimes(1);
  });

  it('bugfix: puts the offline banner above the screens, so it pushes headers down instead of covering them', () => {
    render(<RootLayoutNav />);

    const providers = screen.getAllByTestId('safe-area-provider');
    const screensArea = providers[providers.length - 1];
    // The screens get their own safe-area provider below the banner...
    expect(
      within(screensArea).getByRole('summary', { name: 'root stack' })
    ).toBeTruthy();
    // ...and the banner is outside it, in the flow above.
    expect(within(screensArea).queryByText('connectivity-banner')).toBeNull();
    expect(screen.getByText('connectivity-banner')).toBeTruthy();
  });

  it('passes persistence settings through to the query provider', () => {
    render(<RootLayoutNav persistenceEnabled={false} />);

    expect(mockQueryProvider).toHaveBeenCalledWith(
      expect.objectContaining({ persistenceEnabled: false })
    );
  });

  it('applies the root Android navigation bar style', async () => {
    setPlatformOS('android');

    render(<RootLayoutNav />);

    await waitFor(() => {
      expect(mockSetNavigationBarStyle).toHaveBeenLastCalledWith('dark');
    });
  });

  it('surfaces provider failures deterministically', () => {
    mockQueryProvider.mockImplementation(() => {
      throw new Error('query provider failed');
    });

    expect(() => render(<RootLayoutNav />)).toThrow('query provider failed');
  });

  it('does not render ConnectivityBanner when the template sets connectivityBanner to false', () => {
    mockGetTemplateConfig.mockReturnValueOnce({
      headerStyle: 'standard',
      heroVariant: 'standard',
      categoryStyle: 'pill',
      cardVariant: 'list',
      spacing: 'compact',
      borderRadius: 'md',
      features: {
        connectivityBanner: false,
        chatWidget: false,
        negotiationModal: true,
        drawerMenu: true,
      },
    });

    render(<RootLayoutNav />);

    expect(screen.queryByText('connectivity-banner')).toBeNull();
    expect(screen.queryByText(/^chat-widget:/)).toBeNull();
    expect(screen.getByText('negotiation-modal')).toBeTruthy();
    expect(screen.getByText('drawer-menu')).toBeTruthy();
  });
});
