import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type React from 'react';
import { Text, View } from 'react-native';
import Colors from '@/constants/Colors';
import { PAYMENT_CLIPBOARD_BRIDGE } from '@/constants/payment-clipboard-bridge';
import { PaymentGatewayCheckoutView } from './PaymentGatewayCheckoutView';

const mockStackScreen = jest.fn((_props: unknown) => null);
type MockWebViewProps = {
  injectedJavaScript?: string;
  injectedJavaScriptBeforeContentLoaded?: string;
  onError?: (event: {
    nativeEvent: { description?: string; url?: string };
  }) => void;
  onLoadEnd?: () => void;
  onLoadStart?: () => void;
  onMessage?: (event: { nativeEvent: { data: string } }) => void;
  onNavigationStateChange?: (event: { url: string }) => void;
  source: { uri: string };
};
const mockWebView = jest.fn(
  ({
    injectedJavaScript,
    injectedJavaScriptBeforeContentLoaded,
    source,
  }: MockWebViewProps) => (
    <View accessibilityLabel="mock checkout webview">
      <Text>{`webview:${source.uri}`}</Text>
      <Text>{`injected:${injectedJavaScript === PAYMENT_CLIPBOARD_BRIDGE.script}`}</Text>
      <Text>{`before:${injectedJavaScriptBeforeContentLoaded === PAYMENT_CLIPBOARD_BRIDGE.script}`}</Text>
    </View>
  )
);

jest.mock('expo-router', () => ({
  Stack: {
    Screen: (props: unknown) => mockStackScreen(props),
  },
}));

jest.mock('react-native-webview', () => ({
  WebView: (props: MockWebViewProps) => mockWebView(props),
}));

function ToastComponent() {
  return <View testID="toast-root" />;
}

function getStackOptions(): { headerLeft?: () => React.ReactNode } {
  const stackScreenCall = mockStackScreen.mock.calls[0];
  if (!stackScreenCall) {
    throw new Error('Stack.Screen was not rendered');
  }
  const stackScreenProps = stackScreenCall[0] as
    | {
        options?: { headerLeft?: () => React.ReactNode };
      }
    | undefined;
  if (!stackScreenProps?.options) {
    throw new Error('Stack.Screen options were not configured');
  }
  return stackScreenProps.options;
}

function renderHeaderLeft() {
  const stackOptions = getStackOptions();
  const headerLeft = stackOptions.headerLeft?.();
  if (!headerLeft) {
    throw new Error('Stack.Screen headerLeft was not configured');
  }
  return render(headerLeft as React.ReactElement);
}

function getWebViewProps() {
  const webViewCall = mockWebView.mock.calls[0];
  if (!webViewCall) {
    throw new Error('WebView was not rendered');
  }
  return webViewCall[0];
}

const baseProps = {
  amount: 0,
  authorizationUrl: 'https://checkout.paystack.com/test',
  colors: Colors.light,
  gatewayName: 'Paystack',
  onClose: jest.fn(),
  onError: jest.fn(),
  onLoadEnd: jest.fn(),
  onLoadStart: jest.fn(),
  onMessage: jest.fn(),
  onNavigationStateChange: jest.fn(),
  onShouldStartLoadWithRequest: jest.fn(() => true),
  status: 'ready' as const,
  ToastComponent,
  webViewRef: { current: null },
};

describe('PaymentGatewayCheckoutView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders checkout WebView with clipboard bridge scripts and zero amount banner', () => {
    render(<PaymentGatewayCheckoutView {...baseProps} />);

    expect(
      screen.getByText('webview:https://checkout.paystack.com/test')
    ).toBeOnTheScreen();
    expect(screen.getByText('injected:true')).toBeOnTheScreen();
    expect(screen.getByText('before:true')).toBeOnTheScreen();
    expect(screen.getByText('₦0.00')).toBeOnTheScreen();
    expect(screen.getByTestId('toast-root')).toBeOnTheScreen();
  });

  it('forwards checkout WebView event handlers', () => {
    render(<PaymentGatewayCheckoutView {...baseProps} />);

    const webViewProps = getWebViewProps();
    const errorEvent = {
      nativeEvent: {
        description: 'Gateway unavailable',
        url: 'https://checkout.paystack.com/test',
      },
    };
    const messageEvent = { nativeEvent: { data: '{"type":"ready"}' } };
    const navigationState = {
      url: 'https://usebaci.com/checkout/success',
    };

    webViewProps.onLoadStart?.();
    webViewProps.onLoadEnd?.();
    webViewProps.onMessage?.(messageEvent);
    webViewProps.onNavigationStateChange?.(navigationState);
    webViewProps.onError?.(errorEvent);

    expect(baseProps.onLoadStart).toHaveBeenCalledTimes(1);
    expect(baseProps.onLoadEnd).toHaveBeenCalledTimes(1);
    expect(baseProps.onMessage).toHaveBeenCalledWith(messageEvent);
    expect(baseProps.onNavigationStateChange).toHaveBeenCalledWith(
      navigationState
    );
    expect(baseProps.onError).toHaveBeenCalledWith(errorEvent);
  });

  it('shows a loading overlay and forwards close presses', () => {
    const onClose = jest.fn();

    render(
      <PaymentGatewayCheckoutView
        {...baseProps}
        onClose={onClose}
        status="loading"
      />
    );

    expect(screen.getByText('Loading Paystack...')).toBeOnTheScreen();
    expect(
      screen.getByRole('progressbar', { name: 'Loading Paystack checkout' })
    ).toBeOnTheScreen();

    const headerLeftRender = renderHeaderLeft();
    fireEvent.press(headerLeftRender.getByLabelText('Close payment checkout'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders a fallback when the checkout URL is absent', () => {
    render(
      <PaymentGatewayCheckoutView {...baseProps} authorizationUrl={undefined} />
    );

    expect(screen.getByText('Checkout URL is missing.')).toBeOnTheScreen();
    expect(mockWebView).not.toHaveBeenCalled();
  });

  it('renders funding-safe copy when the caller overrides the missing URL message', () => {
    render(
      <PaymentGatewayCheckoutView
        {...baseProps}
        authorizationUrl={undefined}
        missingUrlMessage="Your funding is saved. Go back and check its status."
      />
    );

    expect(
      screen.getByText('Your funding is saved. Go back and check its status.')
    ).toBeOnTheScreen();
    expect(mockWebView).not.toHaveBeenCalled();
  });
});
