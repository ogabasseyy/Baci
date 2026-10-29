import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { router } from 'expo-router';
import type React from 'react';
import PaymentGatewayScreen from '@/app/payment-gateway';
import { setClipboardString } from '@/lib/clipboard';
import {
  VtuPaymentStillProcessingError,
  waitForVtuConfirmation,
} from '@/lib/vtu-checkout';

const mockToastError = jest.fn();
const mockToastSuccess = jest.fn();
let mockSearchParams = {
  amount: '1000',
  authorizationUrl: 'https://checkout.paystack.com/test',
  customerIdentifier: '43901766923',
  gateway: 'paystack',
  paymentKind: 'vtu',
  reference: 'ref-123',
  utilityType: 'power',
};

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
  router: {
    back: jest.fn(),
    replace: jest.fn(),
  },
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({
    children,
    edges,
  }: {
    children?: React.ReactNode;
    edges?: string[];
  }) => {
    const { View } =
      jest.requireActual<typeof import('react-native')>('react-native');

    return (
      <View accessibilityLabel={`safe-area-edges:${edges?.join(',') ?? 'all'}`}>
        {children}
      </View>
    );
  },
}));

jest.mock('react-native-webview', () => ({
  WebView: ({
    injectedJavaScript,
    injectedJavaScriptBeforeContentLoadedForMainFrameOnly,
    injectedJavaScriptForMainFrameOnly,
    onMessage,
    onNavigationStateChange,
    onShouldStartLoadWithRequest,
    source,
  }: {
    injectedJavaScript?: string;
    injectedJavaScriptBeforeContentLoadedForMainFrameOnly?: boolean;
    injectedJavaScriptForMainFrameOnly?: boolean;
    onMessage?: (event: { nativeEvent: { data: string } }) => void;
    onNavigationStateChange?: (event: { url: string }) => void;
    onShouldStartLoadWithRequest?: (event: { url: string }) => boolean;
    source: { uri: string };
  }) => {
    const { Pressable, Text, View } =
      jest.requireActual<typeof import('react-native')>('react-native');

    return (
      <View>
        <Pressable
          accessibilityLabel="mock-payment-webview"
          onPress={() =>
            onMessage?.({
              nativeEvent: {
                data: JSON.stringify({
                  text: '1234567890',
                  type: 'payment_clipboard_copy',
                }),
              },
            })
          }
        >
          <View>
            <Text>{`webview:${source.uri}`}</Text>
            <Text>{`clipboard-bridge:${
              injectedJavaScript ? 'enabled' : 'missing'
            }`}</Text>
            <Text>{`clipboard-main-frame-only:${String(
              injectedJavaScriptForMainFrameOnly
            )}`}</Text>
            <Text>{`clipboard-before-main-frame-only:${String(
              injectedJavaScriptBeforeContentLoadedForMainFrameOnly
            )}`}</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityLabel="mock-payment-account-detected"
          onPress={() =>
            onMessage?.({
              nativeEvent: {
                data: JSON.stringify({
                  text: '1234567890',
                  type: 'payment_account_number_detected',
                }),
              },
            })
          }
        >
          <Text>detect-account-number</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="mock-payment-success-navigation"
          onPress={() =>
            onShouldStartLoadWithRequest?.({
              url: 'https://usebaci.com/checkout/success?reference=ref-123',
            }) !== false &&
            onNavigationStateChange?.({
              url: 'https://usebaci.com/checkout/success?reference=ref-123',
            })
          }
        >
          <Text>success-navigation</Text>
        </Pressable>
      </View>
    );
  },
}));

jest.mock('@/lib/clipboard', () => ({
  setClipboardString: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {},
}));

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

  return {
    ...actual,
    waitForVtuConfirmation: jest.fn(),
  };
});

jest.mock('@/stores/cart-store', () => ({
  useCartStore: (selector: (state: { clearCart: () => void }) => unknown) =>
    selector({ clearCart: jest.fn() }),
}));

function renderPaymentGatewayScreen() {
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

describe('PaymentGatewayScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockSearchParams = {
      amount: '1000',
      authorizationUrl: 'https://checkout.paystack.com/test',
      customerIdentifier: '43901766923',
      gateway: 'paystack',
      paymentKind: 'vtu',
      reference: 'ref-123',
      utilityType: 'power',
    };
  });

  it('does not apply a top safe-area inset under the native stack header', () => {
    renderPaymentGatewayScreen();

    expect(screen.getByLabelText('safe-area-edges:bottom')).toBeTruthy();
    expect(screen.getByText('Secure Paystack Checkout')).toBeTruthy();
    expect(
      screen.getByText('webview:https://checkout.paystack.com/test')
    ).toBeTruthy();
  });

  it('copies generic gateway text once from WebView clipboard messages', async () => {
    renderPaymentGatewayScreen();

    expect(screen.getByText('clipboard-bridge:enabled')).toBeTruthy();
    expect(screen.getByText('clipboard-main-frame-only:false')).toBeTruthy();
    expect(
      screen.getByText('clipboard-before-main-frame-only:false')
    ).toBeTruthy();

    fireEvent.press(screen.getByLabelText('mock-payment-webview'));

    expect(setClipboardString).toHaveBeenCalledWith('1234567890');
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith('Text copied.')
    );

    fireEvent.press(screen.getByLabelText('mock-payment-webview'));

    expect(setClipboardString).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
  });

  it('keeps decimal precision in the amount banner', () => {
    mockSearchParams = { ...mockSearchParams, amount: '1500.50' };

    renderPaymentGatewayScreen();

    expect(screen.getByText('₦1,500.50')).toBeTruthy();
  });

  it('auto-copies a detected gateway account number without showing a second copy button', async () => {
    renderPaymentGatewayScreen();

    fireEvent.press(screen.getByLabelText('mock-payment-account-detected'));

    await waitFor(() =>
      expect(setClipboardString).toHaveBeenCalledWith('1234567890')
    );
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith('Account number copied.')
    );
    expect(screen.queryByText('Paystack account')).toBeNull();
  });

  it('routes VTU payments that are still processing without showing payment failed', async () => {
    let rejectConfirmation:
      | ((error: VtuPaymentStillProcessingError) => void)
      | undefined;
    (
      waitForVtuConfirmation as jest.MockedFunction<
        typeof waitForVtuConfirmation
      >
    ).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectConfirmation = reject;
        })
    );

    renderPaymentGatewayScreen();

    fireEvent.press(screen.getByLabelText('mock-payment-success-navigation'));

    expect(screen.queryByText('Order Confirmed!')).toBeNull();
    await waitFor(() => {
      expect(screen.getByText('Payment Received')).toBeTruthy();
      expect(
        screen.getByText(
          "We're generating your token now. This usually takes 30-60 seconds, and we'll notify you when it's ready."
        )
      ).toBeTruthy();
    });

    await act(async () => {
      rejectConfirmation?.(
        new VtuPaymentStillProcessingError({
          reference: 'ref-123',
        })
      );
    });

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/utilities/[type]',
        params: expect.objectContaining({
          customerIdentifier: '43901766923',
          paymentStatus: 'processing',
          reference: 'ref-123',
          type: 'power',
        }),
      })
    );
    expect(screen.queryByText('Payment Failed')).toBeNull();
  });

  it('allows VTU confirmation to retry after a transient failure', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    (
      waitForVtuConfirmation as jest.MockedFunction<
        typeof waitForVtuConfirmation
      >
    )
      .mockRejectedValueOnce(new Error('Temporary confirmation error'))
      .mockResolvedValueOnce({
        amount: 1000,
        customerIdentifier: '43901766923',
        reference: 'ref-123',
        status: 'successful',
      });

    renderPaymentGatewayScreen();

    fireEvent.press(screen.getByLabelText('mock-payment-success-navigation'));

    await waitFor(() =>
      expect(screen.getByText('Payment Failed')).toBeTruthy()
    );

    fireEvent.press(screen.getByText('Try Again'));

    await waitFor(() =>
      expect(screen.getByText('Secure Paystack Checkout')).toBeTruthy()
    );
    fireEvent.press(screen.getByLabelText('mock-payment-success-navigation'));

    await waitFor(() =>
      expect(waitForVtuConfirmation).toHaveBeenCalledTimes(2)
    );
    await waitFor(() =>
      expect(screen.getByText('Payment Successful!')).toBeTruthy()
    );
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/utilities/[type]',
        params: expect.objectContaining({
          customerIdentifier: '43901766923',
          paymentStatus: 'successful',
          reference: 'ref-123',
          type: 'power',
        }),
      })
    );
  });
});
