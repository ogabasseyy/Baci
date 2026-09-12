import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Camera, PermissionStatus } from 'expo-camera';
import { router } from 'expo-router';
import type React from 'react';
import { Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import BNPLCheckoutScreen from '@/app/bnpl-checkout';

const mockClearCart = jest.fn();
const mockOpenSettings = jest
  .spyOn(Linking, 'openSettings')
  .mockResolvedValue(undefined);
let mockRenderEvents: string[] = [];
let mockSearchParams: Record<string, string | string[]> = {
  amount: '250000',
  customerEmail: 'customer@example.com',
  customerName: 'Ada Customer',
  customerPhone: '+2348012345678',
  gateway: 'credit_direct',
  merchantSlug: 'ogabassey',
  merchantDomain: 'ogabassey.com',
  orderId: 'order-123',
  trackingToken: 'track-token-123',
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

jest.mock('expo-camera', () => ({
  Camera: {
    requestCameraPermissionsAsync: jest.fn(),
  },
  PermissionStatus: {
    DENIED: 'denied',
    GRANTED: 'granted',
    UNDETERMINED: 'undetermined',
  },
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
    javaScriptCanOpenWindowsAutomatically,
    mediaCapturePermissionGrantType,
    onError,
    onLoadStart,
    onMessage,
    onNavigationStateChange,
    onOpenWindow,
    onShouldStartLoadWithRequest,
    setSupportMultipleWindows,
    source,
    thirdPartyCookiesEnabled,
  }: {
    javaScriptCanOpenWindowsAutomatically?: boolean;
    mediaCapturePermissionGrantType?: string;
    onError?: (event: {
      nativeEvent: { description?: string; url?: string };
    }) => void;
    onLoadStart?: () => void;
    onMessage?: (event: { nativeEvent: { data: string } }) => void;
    onNavigationStateChange?: (event: { url: string }) => void;
    onOpenWindow?: (event: { nativeEvent: { targetUrl: string } }) => void;
    onShouldStartLoadWithRequest?: (event: {
      isTopFrame?: boolean;
      url: string;
    }) => boolean;
    setSupportMultipleWindows?: boolean;
    source: { headers?: Record<string, string>; uri: string };
    thirdPartyCookiesEnabled?: boolean;
  }) => {
    mockRenderEvents.push('webview');
    const { Pressable, Text, View } =
      jest.requireActual<typeof import('react-native')>('react-native');
    const openWindow = (targetUrl: string) =>
      onOpenWindow?.({ nativeEvent: { targetUrl } });

    return (
      <View>
        <Text>{`webview:${source.uri}`}</Text>
        <Text>{`webview-accept:${source.headers?.Accept ?? ''}`}</Text>
        <Text>{`popup-windows:${String(
          javaScriptCanOpenWindowsAutomatically
        )}`}</Text>
        <Text>{`multi-window:${String(setSupportMultipleWindows)}`}</Text>
        <Text>{`open-window-handler:${String(Boolean(onOpenWindow))}`}</Text>
        <Text>{`third-party-cookies:${String(thirdPartyCookiesEnabled)}`}</Text>
        <Text>{`media-capture:${String(
          mediaCapturePermissionGrantType
        )}`}</Text>
        <Pressable
          accessibilityLabel="mock-bnpl-open-credit-direct-popup"
          onPress={() =>
            openWindow('https://checkout.creditdirect.ng/bnpl/session-123')
          }
        >
          <Text>open-credit-direct-popup</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="mock-bnpl-open-untrusted-popup"
          onPress={() => openWindow('https://evil.example/phish')}
        >
          <Text>open-untrusted-popup</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="mock-bnpl-open-blank-popup"
          onPress={() => openWindow('about:blank#provider-popup')}
        >
          <Text>open-blank-popup</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="mock-bnpl-start-untrusted-top-frame"
          onPress={() =>
            onShouldStartLoadWithRequest?.({
              isTopFrame: true,
              url: 'https://evil.example/phish',
            })
          }
        >
          <Text>start-untrusted-top-frame</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="mock-bnpl-start-custom-domain-redirect"
          onPress={() =>
            onShouldStartLoadWithRequest?.({
              isTopFrame: true,
              url: 'https://ogabassey.com/checkout/bnpl?gateway=credit_direct&orderId=order-123&email=customer%40example.com&customerName=Ada+Customer&customerPhone=%2B2348012345678&token=track-token-123',
            })
          }
        >
          <Text>start-custom-domain-redirect</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="mock-bnpl-load-start"
          onPress={() => onLoadStart?.()}
        >
          <Text>load-start</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="mock-bnpl-native-success-navigation"
          onPress={() =>
            onNavigationStateChange?.({
              url: 'https://usebaci.com/order-success?reference=cd-ref',
            })
          }
        >
          <Text>native-success-navigation</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="mock-bnpl-success-message"
          onPress={() =>
            onMessage?.({
              nativeEvent: {
                data: JSON.stringify({
                  reference: 'bnpl-ref-123',
                  type: 'bnpl_success',
                }),
              },
            })
          }
        >
          <Text>success-message</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="mock-bnpl-error-then-load-start"
          onPress={() => {
            onError?.({
              nativeEvent: {
                description: 'Provider connection failed',
                url: source.uri,
              },
            });
            onLoadStart?.();
          }}
        >
          <Text>error-then-load-start</Text>
        </Pressable>
      </View>
    );
  },
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/lib/api-url', () => ({
  resolveApiBaseUrl: () => 'https://usebaci.com',
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: (selector: (state: { clearCart: () => void }) => unknown) =>
    selector({ clearCart: mockClearCart }),
}));

const mockRequestCameraPermissionsAsync = jest.mocked(
  Camera.requestCameraPermissionsAsync
);

function buildCameraPermissionResponse(granted: boolean, canAskAgain = true) {
  return {
    canAskAgain,
    expires: 'never',
    granted,
    status: granted ? PermissionStatus.GRANTED : PermissionStatus.DENIED,
  } satisfies Awaited<ReturnType<typeof Camera.requestCameraPermissionsAsync>>;
}

async function renderReadyBNPLCheckoutScreen() {
  const rendered = render(<BNPLCheckoutScreen />);

  await screen.findByText(/^webview:/);
  return rendered;
}

describe('BNPLCheckoutScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockRenderEvents = [];
    mockRequestCameraPermissionsAsync.mockImplementation(() => {
      mockRenderEvents.push('camera-permission');
      return Promise.resolve(buildCameraPermissionResponse(true));
    });
    mockSearchParams = {
      amount: '250000',
      customerEmail: 'customer@example.com',
      customerName: 'Ada Customer',
      customerPhone: '+2348012345678',
      gateway: 'credit_direct',
      merchantSlug: 'ogabassey',
      merchantDomain: 'ogabassey.com',
      orderId: 'order-123',
      trackingToken: 'track-token-123',
    };
  });

  it('passes public order lookup credentials to the BNPL launcher URL', async () => {
    await renderReadyBNPLCheckoutScreen();

    const webView = screen.getByText(/^webview:/);

    expect(webView.props.children).toContain(
      'https://usebaci.com/ogabassey/checkout/bnpl?'
    );
    expect(webView.props.children).toContain('orderId=order-123');
    expect(webView.props.children).toContain('gateway=credit_direct');
    expect(webView.props.children).toContain('merchant_slug=ogabassey');
    expect(webView.props.children).toContain('email=customer%40example.com');
    expect(webView.props.children).toContain('customerName=Ada+Customer');
    expect(webView.props.children).toContain('customerPhone=%2B2348012345678');
    expect(webView.props.children).toContain('token=track-token-123');
  });

  it('prepares camera permission before loading the Credit Direct provider WebView', async () => {
    await renderReadyBNPLCheckoutScreen();

    expect(mockRequestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockRenderEvents.slice(0, 2)).toEqual([
      'camera-permission',
      'webview',
    ]);
    expect(screen.getByText('media-capture:grant')).toBeTruthy();
  });

  it('skips camera permission checks for non-Credit Direct gateways', async () => {
    mockSearchParams = {
      amount: '120000',
      authorizationUrl:
        'https://usebaci.com/ogabassey/checkout/bnpl?gateway=klump&orderId=order-123&reference=BAC-ABCD12345678&trackingToken=track-token-123',
      customerEmail: 'customer@example.com',
      customerName: 'Ada Customer',
      gateway: 'klump',
      merchantSlug: 'ogabassey',
      merchantDomain: 'ogabassey.com',
      orderId: 'order-123',
      reference: 'BAC-ABCD12345678',
      trackingToken: 'track-token-123',
    };

    await renderReadyBNPLCheckoutScreen();

    expect(mockRequestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(mockRenderEvents).not.toContain('camera-permission');
    expect(mockRenderEvents.every((event) => event === 'webview')).toBe(true);
    expect(screen.getByText('media-capture:prompt')).toBeTruthy();
  });

  it('shows a retryable app error when Credit Direct camera permission is denied', async () => {
    mockRequestCameraPermissionsAsync
      .mockImplementationOnce(() => {
        mockRenderEvents.push('camera-permission');
        return Promise.resolve(buildCameraPermissionResponse(false));
      })
      .mockImplementationOnce(() => {
        mockRenderEvents.push('camera-permission');
        return Promise.resolve(buildCameraPermissionResponse(true));
      });

    render(<BNPLCheckoutScreen />);

    expect(
      await screen.findByText(
        'Camera access is required to complete Credit Direct identity verification. Enable camera permission and try again.'
      )
    ).toBeTruthy();
    expect(screen.queryByText(/^webview:/)).toBeNull();

    fireEvent.press(screen.getByText('Try Again'));

    await waitFor(() =>
      expect(mockRequestCameraPermissionsAsync).toHaveBeenCalledTimes(2)
    );
    expect(await screen.findByText(/^webview:/)).toBeTruthy();
  });

  it('opens device settings when Credit Direct camera permission cannot be requested again', async () => {
    mockRequestCameraPermissionsAsync.mockImplementationOnce(() => {
      mockRenderEvents.push('camera-permission');
      return Promise.resolve(buildCameraPermissionResponse(false, false));
    });

    render(<BNPLCheckoutScreen />);

    expect(
      await screen.findByText(
        'Camera access is required to complete Credit Direct identity verification. Enable camera permission in device settings and return to checkout.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Open Settings')).toBeTruthy();
    expect(screen.queryByText(/^webview:/)).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Open app settings' }));

    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
    expect(mockRequestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('accepts Klump as a BNPL gateway and loads the explicit authorization URL', async () => {
    mockSearchParams = {
      amount: '120000',
      authorizationUrl:
        'https://usebaci.com/ogabassey/checkout/bnpl?gateway=klump&orderId=order-123&reference=BAC-ABCD12345678&trackingToken=track-token-123',
      customerEmail: 'customer@example.com',
      customerName: 'Ada Customer',
      gateway: 'klump',
      merchantSlug: 'ogabassey',
      merchantDomain: 'ogabassey.com',
      orderId: 'order-123',
      reference: 'BAC-ABCD12345678',
      trackingToken: 'track-token-123',
    };

    await renderReadyBNPLCheckoutScreen();

    const webViewUrl = new URL(
      screen.getByText(/^webview:/).props.children.replace('webview:', '')
    );
    expect(webViewUrl.origin).toBe('https://usebaci.com');
    expect(webViewUrl.pathname).toBe('/ogabassey/checkout/bnpl');
    expect(webViewUrl.searchParams.get('gateway')).toBe('klump');
    expect(webViewUrl.searchParams.get('orderId')).toBe('order-123');
    expect(webViewUrl.searchParams.get('reference')).toBe('BAC-ABCD12345678');
    expect(webViewUrl.searchParams.get('trackingToken')).toBe(
      'track-token-123'
    );
    expect(webViewUrl.searchParams.get('merchant_slug')).toBe('ogabassey');
  });

  it('loads BNPL launcher URLs as HTML documents instead of Next data payloads', async () => {
    mockSearchParams = {
      amount: '120000',
      authorizationUrl:
        'https://usebaci.com/ogabassey/checkout/bnpl?gateway=klump&orderId=order-123&reference=BAC-ABCD12345678&_rsc=flight-payload&trackingToken=track-token-123',
      customerEmail: 'customer@example.com',
      customerName: 'Ada Customer',
      gateway: 'klump',
      merchantSlug: 'ogabassey',
      merchantDomain: 'ogabassey.com',
      orderId: 'order-123',
      reference: 'BAC-ABCD12345678',
      trackingToken: 'track-token-123',
    };

    await renderReadyBNPLCheckoutScreen();

    const webViewUrl = new URL(
      screen.getByText(/^webview:/).props.children.replace('webview:', '')
    );
    expect(webViewUrl.searchParams.has('_rsc')).toBe(false);
    expect(screen.getByText(/^webview-accept:/).props.children).toContain(
      'text/html'
    );
  });

  it('uses the first value when Android delivers duplicated Klump params', async () => {
    mockSearchParams = {
      amount: '120000',
      authorizationUrl: [
        'https://ogabassey.usebaci.com/checkout/bnpl?gateway=klump&orderId=order-123&reference=BAC-ABCD12345678&trackingToken=track-token-123',
        'https://unexpected.example/checkout',
      ],
      customerEmail: ['customer@example.com', 'duplicate@example.com'],
      customerName: 'Ada Customer',
      gateway: ['klump', 'credit_direct'],
      merchantSlug: 'ogabassey',
      merchantDomain: 'ogabassey.com',
      orderId: 'order-123',
      reference: 'BAC-ABCD12345678',
      trackingToken: 'track-token-123',
    };

    await renderReadyBNPLCheckoutScreen();

    const webViewUrl = new URL(
      screen.getByText(/^webview:/).props.children.replace('webview:', '')
    );
    expect(webViewUrl.origin).toBe('https://usebaci.com');
    expect(webViewUrl.pathname).toBe('/ogabassey/checkout/bnpl');
    expect(webViewUrl.searchParams.get('gateway')).toBe('klump');
    expect(webViewUrl.searchParams.get('orderId')).toBe('order-123');
    expect(webViewUrl.searchParams.get('reference')).toBe('BAC-ABCD12345678');
    expect(webViewUrl.searchParams.get('trackingToken')).toBe(
      'track-token-123'
    );
  });

  it('repairs Android-split Klump authorization URLs before loading the WebView', async () => {
    mockSearchParams = {
      amount: '120000',
      authorizationUrl:
        'https://ogabassey.usebaci.com/checkout/bnpl?gateway=klump',
      customerEmail: 'customer@example.com',
      customerName: 'Ada Customer',
      customerPhone: '+2348012345678',
      gateway: 'klump',
      merchantSlug: 'ogabassey',
      merchantDomain: 'ogabassey.com',
      orderId: 'order-123',
      reference: 'BAC-ABCD12345678',
      trackingToken: 'track-token-123',
    };

    await renderReadyBNPLCheckoutScreen();

    const webViewUrl = new URL(
      screen.getByText(/^webview:/).props.children.replace('webview:', '')
    );
    expect(webViewUrl.origin).toBe('https://usebaci.com');
    expect(webViewUrl.pathname).toBe('/ogabassey/checkout/bnpl');
    expect(webViewUrl.searchParams.get('gateway')).toBe('klump');
    expect(webViewUrl.searchParams.get('orderId')).toBe('order-123');
    expect(webViewUrl.searchParams.get('reference')).toBe('BAC-ABCD12345678');
    expect(webViewUrl.searchParams.get('trackingToken')).toBe(
      'track-token-123'
    );
    expect(webViewUrl.searchParams.get('email')).toBe('customer@example.com');
    expect(webViewUrl.searchParams.get('customerPhone')).toBe('+2348012345678');
  });

  it('falls back to the trusted origin for untrusted Klump authorization URLs', async () => {
    mockSearchParams = {
      amount: '120000',
      authorizationUrl:
        'https://evil.example/checkout/bnpl?gateway=klump&steal=true',
      customerEmail: 'customer@example.com',
      customerPhone: '+2348012345678',
      gateway: 'klump',
      merchantSlug: 'ogabassey',
      merchantDomain: 'ogabassey.com',
      orderId: 'order-123',
      reference: 'BAC-ABCD12345678',
      trackingToken: 'track-token-123',
    };

    await renderReadyBNPLCheckoutScreen();

    const webViewUrl = new URL(
      screen.getByText(/^webview:/).props.children.replace('webview:', '')
    );
    expect(webViewUrl.origin).toBe('https://usebaci.com');
    expect(webViewUrl.pathname).toBe('/ogabassey/checkout/bnpl');
    expect(webViewUrl.searchParams.get('gateway')).toBe('klump');
    expect(webViewUrl.searchParams.get('orderId')).toBe('order-123');
    expect(webViewUrl.searchParams.get('reference')).toBe('BAC-ABCD12345678');
    expect(webViewUrl.searchParams.get('trackingToken')).toBe(
      'track-token-123'
    );
    expect(webViewUrl.searchParams.get('email')).toBe('customer@example.com');
    expect(webViewUrl.searchParams.has('steal')).toBe(false);
  });

  it('allows Credit Direct popup windows to render in the Android WebView', async () => {
    await renderReadyBNPLCheckoutScreen();

    expect(screen.getByText('popup-windows:true')).toBeTruthy();
    expect(screen.getByText('multi-window:undefined')).toBeTruthy();
    expect(screen.getByText('open-window-handler:true')).toBeTruthy();
    expect(screen.getByText('third-party-cookies:true')).toBeTruthy();
  });

  it('loads allowed Credit Direct popup windows in the same WebView', async () => {
    await renderReadyBNPLCheckoutScreen();

    fireEvent.press(
      screen.getByLabelText('mock-bnpl-open-credit-direct-popup')
    );

    expect(screen.getByText(/^webview:/).props.children).toBe(
      'webview:https://checkout.creditdirect.ng/bnpl/session-123'
    );
  });

  it('surfaces untrusted auxiliary popup windows as retryable checkout errors', async () => {
    const consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    await renderReadyBNPLCheckoutScreen();

    fireEvent.press(screen.getByLabelText('mock-bnpl-open-untrusted-popup'));

    expect(
      screen.getByText('Payment provider opened an untrusted checkout window.')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
    consoleWarnSpy.mockRestore();
  });

  it('blocks untrusted top-frame navigations from replacing checkout', async () => {
    await renderReadyBNPLCheckoutScreen();

    fireEvent.press(
      screen.getByLabelText('mock-bnpl-start-untrusted-top-frame')
    );

    expect(
      screen.getByText('Payment provider opened an untrusted checkout window.')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
  });

  it('allows configured merchant custom-domain document redirects', async () => {
    await renderReadyBNPLCheckoutScreen();
    const initialWebViewUrl = screen.getByText(/^webview:/).props.children;

    fireEvent.press(
      screen.getByLabelText('mock-bnpl-start-custom-domain-redirect')
    );

    expect(screen.getByText(/^webview:/).props.children).toBe(
      initialWebViewUrl
    );
    expect(
      screen.queryByText(
        'Payment provider opened an untrusted checkout window.'
      )
    ).toBeNull();
  });

  it('ignores blank provider popup targets without showing the untrusted checkout error', async () => {
    await renderReadyBNPLCheckoutScreen();

    const initialWebViewUrl = screen.getByText(/^webview:/).props.children;
    fireEvent.press(screen.getByLabelText('mock-bnpl-open-blank-popup'));

    expect(screen.getByText(/^webview:/).props.children).toBe(
      initialWebViewUrl
    );
    expect(
      screen.queryByText(
        'Payment provider opened an untrusted checkout window.'
      )
    ).toBeNull();
  });

  it('shows a retryable error when the BNPL checkout page stalls while loading', async () => {
    jest.useFakeTimers();
    await renderReadyBNPLCheckoutScreen();

    fireEvent.press(screen.getByLabelText('mock-bnpl-load-start'));

    act(() => {
      jest.advanceTimersByTime(45_000);
    });

    expect(
      screen.getByText(
        'Payment page is taking longer than expected. Check your connection and try again.'
      )
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
  });

  it('routes native BNPL success navigation to the native order success screen', async () => {
    jest.useFakeTimers();
    await renderReadyBNPLCheckoutScreen();

    await act(async () => {
      fireEvent.press(
        screen.getByLabelText('mock-bnpl-native-success-navigation')
      );
    });

    expect(mockClearCart).toHaveBeenCalledTimes(1);

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: {
        orderId: 'order-123',
        paymentMethod: 'credit_direct',
        reference: 'cd-ref',
        trackingToken: 'track-token-123',
      },
    });
  });

  it('ignores raw BNPL success messages because they do not prove navigation source', async () => {
    jest.useFakeTimers();
    await renderReadyBNPLCheckoutScreen();

    fireEvent.press(screen.getByLabelText('mock-bnpl-success-message'));

    expect(mockClearCart).not.toHaveBeenCalled();

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(router.replace).not.toHaveBeenCalled();
  });

  it('preserves WebView errors through immediate follow-up load events', async () => {
    await renderReadyBNPLCheckoutScreen();

    fireEvent.press(screen.getByLabelText('mock-bnpl-error-then-load-start'));

    expect(screen.getByText('Provider connection failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
  });

  it('allows top-frame redirects to configured merchant custom domains', async () => {
    const { UNSAFE_getByType } = await renderReadyBNPLCheckoutScreen();
    const webView = UNSAFE_getByType(WebView);

    const redirectUrl =
      'https://ogabassey.com/checkout/bnpl?gateway=credit_direct&orderId=order-123&merchant_slug=ogabassey&email=customer%40example.com&customerName=Ada+Customer&customerPhone=%2B2348012345678&token=track-token-123';

    let result = true;
    act(() => {
      result = webView.props.onShouldStartLoadWithRequest({
        isTopFrame: true,
        url: redirectUrl,
      });
    });

    expect(result).toBe(true);
    expect(
      screen.queryByText(
        'Payment provider opened an untrusted checkout window.'
      )
    ).toBeNull();
  });

  it('blocks top-frame redirects to route-param spoofed merchant custom domains', async () => {
    mockSearchParams = {
      ...mockSearchParams,
      merchantDomain: 'evil.example',
    };

    const { UNSAFE_getByType } = await renderReadyBNPLCheckoutScreen();
    const webView = UNSAFE_getByType(WebView);

    const redirectUrl =
      'https://evil.example/checkout/bnpl?gateway=credit_direct&orderId=order-123&merchant_slug=ogabassey&email=customer%40example.com&customerName=Ada+Customer&customerPhone=%2B2348012345678&token=track-token-123';

    let result = true;
    act(() => {
      result = webView.props.onShouldStartLoadWithRequest({
        isTopFrame: true,
        url: redirectUrl,
      });
    });

    expect(result).toBe(false);
    expect(
      screen.getByText('Payment provider opened an untrusted checkout window.')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
  });
});
