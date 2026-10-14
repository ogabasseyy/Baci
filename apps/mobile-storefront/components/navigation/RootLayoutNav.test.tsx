import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react-native';
import type React from 'react';
import { Platform, Text, View } from 'react-native';
import { CHAT_WIDGET_DEFAULT_BOTTOM_OFFSET } from '@/constants/layout';
import { getTemplateConfig } from '@/lib/templates';
import { RootLayoutNav } from './RootLayoutNav';

const mockGetTemplateConfig = getTemplateConfig as jest.MockedFunction<
  typeof getTemplateConfig
>;

const MockText = Text;
const MockView = View;
const mockUseAuthGuard = jest.fn();
const mockSetNavigationBarStyle = jest.fn();
const originalPlatformOS = Platform.OS;
const renderMockQueryProvider = ({
  children,
  persistenceEnabled,
}: {
  children?: React.ReactNode;
  persistenceEnabled?: boolean;
}) => (
  <View>
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
  const Stack = ({ children }: { children?: React.ReactNode }) => (
    <MockView
      accessibilityLabel="root stack"
      accessibilityRole="summary"
      accessible
      testID="root-stack"
    >
      {children}
    </MockView>
  );

  Stack.Screen = ({ name }: { name: string }) => <MockText>{name}</MockText>;

  return {
    router: { replace: jest.fn() },
    Stack,
    useGlobalSearchParams: () => ({}),
    useSegments: () => [],
    usePathname: () => '/',
    useRootNavigationState: () => ({ key: 'root' }),
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
  SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock('@/components/cart/SharedCartBridge', () => ({
  SharedCartBridge: () => <MockText>shared-cart-bridge</MockText>,
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
    setPlatformOS(originalPlatformOS);
  });

  afterEach(() => {
    setPlatformOS(originalPlatformOS);
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
