import { jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type React from 'react';
import PaymentGatewayScreen from '@/app/payment-gateway';

let mockSearchParams: Record<string, string> = {};
const mockToastError = jest.fn();
const mockToastSuccess = jest.fn();

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: React.ReactNode }) => {
    const { View } =
      jest.requireActual<typeof import('react-native')>('react-native');
    return <View>{children}</View>;
  },
}));

jest.mock('react-native-webview', () => ({
  WebView: ({
    onLoadStart,
    onMessage,
    source,
    startInLoadingState,
  }: {
    onLoadStart?: () => void;
    onMessage?: (event: { nativeEvent: { data: string } }) => void;
    source: { uri: string };
    startInLoadingState?: boolean;
  }) => {
    const { Pressable, Text, View } =
      jest.requireActual<typeof import('react-native')>('react-native');
    return (
      <View>
        <Pressable
          accessibilityLabel="mock-checkout-load-start"
          onPress={onLoadStart}
        >
          <Text>start-loading</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="mock-checkout-interactive"
          onPress={() =>
            onMessage?.({
              nativeEvent: {
                data: JSON.stringify({ type: 'baci_payment_page_interactive' }),
              },
            })
          }
        >
          <Text>{`webview-start-loading:${String(startInLoadingState)}`}</Text>
        </Pressable>
        <Text>{`webview:${source.uri}`}</Text>
      </View>
    );
  },
}));

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(),
  WebBrowserResultType: { DISMISS: 'dismiss' },
}));

jest.mock('@/lib/wallet-top-up', () => ({
  waitForWalletTopUpConfirmation: jest.fn(),
  WalletTopUpStillProcessingError: class extends Error {},
}));

jest.mock('@/lib/wallet-funding-intent', () => ({
  clearWalletFundingIntentIfUnchanged: jest.fn(async () => true),
  readWalletFundingIntentSnapshot: jest.fn(async () => null),
}));

jest.mock('@/lib/clipboard', () => ({
  setClipboardString: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    error: mockToastError,
    success: mockToastSuccess,
    Toast: () => {
      const { View } =
        jest.requireActual<typeof import('react-native')>('react-native');
      return <View testID="toast-root" />;
    },
  }),
}));

jest.mock('@/lib/vtu-checkout', () => {
  const actual =
    jest.requireActual<typeof import('@/lib/vtu-checkout')>(
      '@/lib/vtu-checkout'
    );
  return { ...actual, waitForVtuConfirmation: jest.fn() };
});

jest.mock('@/stores/cart-store', () => ({
  useCartStore: (selector: (state: { clearCart: () => void }) => unknown) =>
    selector({ clearCart: jest.fn() }),
}));

export function setWalletSearchParams(params: Record<string, string>) {
  mockSearchParams = params;
}

export function renderWalletCheckoutScreen() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PaymentGatewayScreen />
    </QueryClientProvider>
  );
}
