import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import {
  trackCheckoutPaymentCompletedOnce,
  trackCheckoutPaymentFailed,
  trackCheckoutPaymentStarted,
} from '@/services/analytics';
import { BNPL_UNTRUSTED_POPUP_MESSAGE } from './bnpl-checkout.helpers';
import { useBNPLCheckoutController } from './use-bnpl-checkout-controller';

jest.mock('@/services/analytics', () => ({
  trackCheckoutPaymentCompletedOnce: jest.fn(async () => true),
  trackCheckoutPaymentFailed: jest.fn(),
  trackCheckoutPaymentStarted: jest.fn(async () => undefined),
}));

const mockClearCart = jest.fn();
let mockRouteParams: Record<string, string> = {
  gateway: 'credit_direct',
  orderId: 'order-123',
};

const renderControllerHook = (merchantDomain?: string) =>
  renderHook(() =>
    useBNPLCheckoutController({
      apiBaseUrl: 'https://usebaci.com',
      merchantDomain,
      params: mockRouteParams,
    })
  );

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    replace: jest.fn(),
  },
  useLocalSearchParams: () => mockRouteParams,
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/lib/api-url', () => ({
  resolveApiBaseUrl: () => 'https://usebaci.com',
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: Object.assign(
    (selector: (state: { clearCart: () => void }) => unknown) =>
      selector({ clearCart: mockClearCart }),
    { getState: () => ({ items: [] }) }
  ),
}));

describe('useBNPLCheckoutController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {
      gateway: 'credit_direct',
      orderId: 'order-123',
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('keeps the pending load timeout through rerenders and clears it on unmount', () => {
    jest.useFakeTimers();
    const { result, rerender, unmount } = renderControllerHook();

    act(() => {
      result.current.handleLoadStart();
    });
    expect(jest.getTimerCount()).toBe(1);

    rerender({});
    expect(jest.getTimerCount()).toBe(1);

    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('records the start when the launcher confirms the provider opened', async () => {
    mockRouteParams = {
      gateway: 'credit_direct',
      orderId: 'order-123',
      amount: '21500',
      trackingToken: 'track-token-123',
    };
    const { result } = renderControllerHook();

    await act(async () => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'bnpl_provider_opened',
            gateway: 'credit_direct',
            orderId: 'order-123',
          }),
        },
      });
    });

    expect(trackCheckoutPaymentStarted).toHaveBeenCalledTimes(1);
    expect(trackCheckoutPaymentStarted).toHaveBeenCalledWith({
      orderId: 'order-123',
      paymentMethod: 'credit_direct',
      value: 21500,
    });
  });

  it('records a single start for duplicate provider-opened signals', async () => {
    mockRouteParams = {
      gateway: 'credpal',
      orderId: 'order-123',
      amount: '21500',
    };
    const { result } = renderControllerHook();
    const message = {
      nativeEvent: {
        data: JSON.stringify({
          type: 'bnpl_provider_opened',
          gateway: 'credpal',
          orderId: 'order-123',
        }),
      },
    };

    await act(async () => {
      result.current.handleWebViewMessage(message);
    });
    await act(async () => {
      result.current.handleWebViewMessage(message);
    });

    expect(trackCheckoutPaymentStarted).toHaveBeenCalledTimes(1);
  });

  it('records a fresh start for the retried attempt after open then failure', async () => {
    mockRouteParams = {
      gateway: 'credit_direct',
      orderId: 'order-123',
      amount: '21500',
    };
    const { result } = renderControllerHook();
    const openedMessage = {
      nativeEvent: {
        data: JSON.stringify({
          type: 'bnpl_provider_opened',
          gateway: 'credit_direct',
          orderId: 'order-123',
        }),
      },
    };

    // First attempt opens (start recorded) then fails at load.
    await act(async () => {
      result.current.handleWebViewMessage(openedMessage);
    });
    act(() => {
      result.current.handleWebViewError({
        description: 'net::ERR_FAILED',
        url: 'https://pay.example/x',
      });
    });
    expect(trackCheckoutPaymentStarted).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('error');

    // Retry must reset the start guard alongside the failure guard, so
    // the reopened provider flow emits its own start to match any later
    // failure instead of producing an unmatched payment_failed.
    act(() => {
      result.current.handleRetry();
    });
    await act(async () => {
      result.current.handleWebViewMessage(openedMessage);
    });

    expect(trackCheckoutPaymentStarted).toHaveBeenCalledTimes(2);
  });

  it('ignores provider-opened signals for a different order', async () => {
    mockRouteParams = {
      gateway: 'credit_direct',
      orderId: 'order-123',
    };
    const { result } = renderControllerHook();

    await act(async () => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'bnpl_provider_opened',
            gateway: 'credit_direct',
            orderId: 'order-other',
          }),
        },
      });
    });

    expect(trackCheckoutPaymentStarted).not.toHaveBeenCalled();
  });

  it('reloads the active checkout document when retrying the same BNPL URL', () => {
    const { result } = renderControllerHook();
    const reload = jest.fn();

    act(() => {
      Object.assign(result.current.webViewRef, { current: { reload } });
      result.current.handleRetry();
    });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload an unmounted checkout source when retrying invalid params', () => {
    mockRouteParams = {};
    const { result } = renderControllerHook();
    const reload = jest.fn();

    act(() => {
      Object.assign(result.current.webViewRef, { current: { reload } });
      result.current.handleRetry();
    });

    expect(reload).not.toHaveBeenCalled();
  });

  it('handles trusted app-host SPA success navigation messages from the WebView', async () => {
    jest.useFakeTimers();
    mockRouteParams = {
      gateway: 'credit_direct',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
      trackingToken: 'track-token-123',
    };
    const { result } = renderControllerHook();

    await act(async () => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'navigation',
            url: 'https://usebaci.com/ogabassey/order-success?reference=BAC-123',
          }),
        },
      });
    });

    expect(result.current.status).toBe('success');
    expect(mockClearCart).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: {
        orderId: 'order-123',
        paymentMethod: 'credit_direct',
        reference: 'BAC-123',
        trackingToken: 'track-token-123',
      },
    });
  });

  it('attributes the full order total when credit partially covers a BNPL order', async () => {
    mockRouteParams = {
      gateway: 'credpal',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
      trackingToken: 'track-token-123',
      // Wallet credit covered all but 750 of the 5750 order: the provider
      // charges the residual, but revenue is the canonical total.
      amount: '750',
      orderTotal: '5750',
    };
    const { result } = renderControllerHook();

    await act(async () => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'navigation',
            url: 'https://usebaci.com/ogabassey/order-success?reference=CP-1',
          }),
        },
      });
    });

    expect(trackCheckoutPaymentCompletedOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-123',
        paymentMethod: 'credpal',
        value: 5750,
      })
    );
  });

  it('does not trust merchantDomain route params for SPA success navigation messages', () => {
    mockRouteParams = {
      gateway: 'credit_direct',
      merchantDomain: 'ogabassey.com',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
    };
    const { result } = renderControllerHook();

    act(() => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'navigation',
            url: 'https://ogabassey.com/order-success?reference=forged',
          }),
        },
      });
    });

    expect(result.current.status).toBe('loading');
    expect(mockClearCart).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('trusts configured merchant domains for SPA success navigation messages', async () => {
    jest.useFakeTimers();
    mockRouteParams = {
      gateway: 'credit_direct',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
      trackingToken: 'track-token-123',
    };
    const { result } = renderControllerHook('ogabassey.com');

    await act(async () => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'navigation',
            url: 'https://ogabassey.com/order-success?reference=BAC-456',
          }),
        },
      });
    });

    expect(result.current.status).toBe('success');
    expect(mockClearCart).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: {
        orderId: 'order-123',
        paymentMethod: 'credit_direct',
        reference: 'BAC-456',
        trackingToken: 'track-token-123',
      },
    });
  });

  it('returns to the app when a trusted merchant SPA navigation leaves BNPL checkout', () => {
    mockRouteParams = {
      gateway: 'credit_direct',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
    };
    const { result } = renderControllerHook('ogabassey.com');

    act(() => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'navigation',
            url: 'https://ogabassey.com/',
          }),
        },
      });
    });

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(mockClearCart).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('returns to the app when Credit Direct posts a provider close message', () => {
    const { result } = renderControllerHook('ogabassey.com');

    act(() => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            message: 'Provider postMessage received',
            source: 'https://checkout.creditdirect.ng',
            summary: {
              payloadType: 'object',
              type: 'checkout.widget.closed',
            },
            type: 'bnpl_log',
          }),
        },
      });
    });

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(result.current.status).not.toBe('error');
    expect(result.current.errorMessage).toBeNull();
  });

  it('routes manual close confirmation through the guarded provider exit handler', () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const { result } = renderControllerHook('ogabassey.com');

    act(() => {
      result.current.handleClose();
    });

    const actions = alertSpy.mock.calls[0]?.[2] as
      | Array<{ onPress?: () => void }>
      | undefined;

    act(() => {
      actions?.[1]?.onPress?.();
      actions?.[1]?.onPress?.();
    });

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(result.current.status).not.toBe('error');
    expect(result.current.errorMessage).toBeNull();
  });

  it('clears a transient provider error before returning to the app on close', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderControllerHook('ogabassey.com');

    act(() => {
      result.current.handleOpenWindow({
        nativeEvent: {
          targetUrl: 'https://evil.example/popup',
        },
      });
    });
    expect(result.current.status).toBe('error');

    act(() => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            message: 'Provider postMessage received',
            source: 'https://checkout.creditdirect.ng',
            summary: {
              payloadType: 'object',
              type: 'checkout.widget.closed',
            },
            type: 'bnpl_log',
          }),
        },
      });
    });

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(result.current.status).not.toBe('error');
    expect(result.current.errorMessage).toBeNull();
  });

  it('returns to the app for trusted checkout cancellation navigations', () => {
    mockRouteParams = {
      gateway: 'credit_direct',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
    };
    const { result } = renderControllerHook('ogabassey.com');

    act(() => {
      result.current.handleNavigationChange({
        url: 'https://ogabassey.com/checkout?cancelled=true',
      } as Parameters<typeof result.current.handleNavigationChange>[0]);
    });

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(result.current.status).not.toBe('error');
    expect(result.current.errorMessage).toBeNull();
  });

  it('allows configured merchant domains for top-frame checkout document redirects', () => {
    mockRouteParams = {
      gateway: 'credit_direct',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
    };
    const { result } = renderControllerHook('ogabassey.com');

    let shouldStart = false;
    act(() => {
      shouldStart = result.current.handleShouldStartLoadWithRequest({
        canGoBack: false,
        canGoForward: false,
        isTopFrame: true,
        loading: true,
        lockIdentifier: 1,
        navigationType: 'other',
        title: 'BNPL checkout',
        url: 'https://ogabassey.com/checkout/bnpl?gateway=credit_direct&orderId=order-123',
      });
    });

    expect(shouldStart).toBe(true);
    expect(result.current.errorMessage).toBeNull();
  });

  it('blocks trusted merchant home document navigations and returns to the app', () => {
    mockRouteParams = {
      gateway: 'credit_direct',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
    };
    const { result } = renderControllerHook('ogabassey.com');

    let shouldStart = true;
    act(() => {
      shouldStart = result.current.handleShouldStartLoadWithRequest({
        canGoBack: false,
        canGoForward: false,
        isTopFrame: true,
        loading: true,
        lockIdentifier: 1,
        navigationType: 'other',
        title: 'Ogabassey',
        url: 'https://ogabassey.com/',
      });
    });

    expect(shouldStart).toBe(false);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(result.current.errorMessage).toBeNull();
  });

  it('surfaces untrusted auxiliary windows as checkout errors', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderControllerHook();

    act(() => {
      result.current.handleOpenWindow({
        nativeEvent: {
          targetUrl: 'https://evil.example/popup',
        },
      });
    });

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBe(BNPL_UNTRUSTED_POPUP_MESSAGE);
  });

  it('skips paid attribution for pending CredPal redirects but still navigates', async () => {
    jest.useFakeTimers();
    mockRouteParams = {
      gateway: 'credpal',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
      trackingToken: 'track-token-123',
    };
    const { result } = renderControllerHook();

    await act(async () => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'navigation',
            url: 'https://usebaci.com/ogabassey/order-success?type=credpal&orderId=order-123&credpalStatus=pending',
          }),
        },
      });
    });

    expect(result.current.status).toBe('success');
    expect(trackCheckoutPaymentCompletedOnce).not.toHaveBeenCalled();
    expect(trackCheckoutPaymentFailed).not.toHaveBeenCalled();
    expect(mockClearCart).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: {
        orderId: 'order-123',
        paymentMethod: 'credpal',
        trackingToken: 'track-token-123',
      },
    });
  });

  it('defers Klump returns to settlement polling instead of completing', async () => {
    jest.useFakeTimers();
    mockRouteParams = {
      gateway: 'klump',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
      trackingToken: 'track-token-123',
    };
    const { result } = renderControllerHook();

    await act(async () => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'navigation',
            url: 'https://usebaci.com/ogabassey/order-success?reference=klump_tx_1',
          }),
        },
      });
    });

    // The transaction-ID return proves nothing about settlement: no
    // completion, but the shopper still reaches success with the token so
    // settlement polling can confirm payment later.
    expect(result.current.status).toBe('success');
    expect(trackCheckoutPaymentCompletedOnce).not.toHaveBeenCalled();
    expect(trackCheckoutPaymentFailed).not.toHaveBeenCalled();
    expect(mockClearCart).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/order-success',
      params: {
        orderId: 'order-123',
        paymentMethod: 'klump',
        reference: 'klump_tx_1',
        trackingToken: 'track-token-123',
      },
    });
  });

  it('records paid attribution for approved CredPal redirects', async () => {
    jest.useFakeTimers();
    mockRouteParams = {
      gateway: 'credpal',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
      trackingToken: 'track-token-123',
    };
    const { result } = renderControllerHook();

    await act(async () => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'navigation',
            url: 'https://usebaci.com/ogabassey/order-success?type=credpal&orderId=order-123&credpalStatus=success',
          }),
        },
      });
    });

    expect(result.current.status).toBe('success');
    expect(trackCheckoutPaymentCompletedOnce).toHaveBeenCalledTimes(1);
    expect(trackCheckoutPaymentCompletedOnce).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-123' })
    );
  });

  it('carries guest attribution into approved BNPL completions', async () => {
    mockRouteParams = {
      gateway: 'credpal',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
      trackingToken: 'track-token-123',
      customerEmail: 'guest@example.com',
      customerPhone: '+2348123456789',
      amount: '470000',
      subtotal: '450000',
      shipping: '15000',
      tax: '5000',
    };
    const { result } = renderControllerHook();

    await act(async () => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'navigation',
            url: 'https://usebaci.com/ogabassey/order-success?type=credpal&orderId=order-123&credpalStatus=success',
          }),
        },
      });
    });

    expect(result.current.status).toBe('success');
    expect(trackCheckoutPaymentCompletedOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        customerEmail: 'guest@example.com',
        customerPhone: '+2348123456789',
        orderId: 'order-123',
        shipping: 15000,
        subtotal: 450000,
        tax: 5000,
      })
    );
  });

  it('emits payment_failed for terminal provider error redirects', async () => {
    mockRouteParams = {
      gateway: 'credit_direct',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
    };
    const { result } = renderControllerHook();

    await act(async () => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'navigation',
            url: 'https://usebaci.com/ogabassey/checkout?error=declined',
          }),
        },
      });
    });

    expect(result.current.status).toBe('error');
    expect(trackCheckoutPaymentFailed).toHaveBeenCalledWith(
      'bnpl_provider_error',
      'order-123',
      'credit_direct'
    );
    expect(trackCheckoutPaymentCompletedOnce).not.toHaveBeenCalled();
  });

  it('matches an SDK failure to its opened provider via the bridged error', async () => {
    mockRouteParams = {
      gateway: 'credpal',
      orderId: 'order-123',
      amount: '21500',
    };
    const { result } = renderControllerHook();

    await act(async () => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'bnpl_provider_opened',
            gateway: 'credpal',
            orderId: 'order-123',
          }),
        },
      });
    });
    expect(trackCheckoutPaymentStarted).toHaveBeenCalledTimes(1);

    // The opened widget's SDK then fails: the bridged error must reach
    // the failure recorder (not strand the start) and surface retry UI.
    await act(async () => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'bnpl_provider_error',
            gateway: 'credpal',
            orderId: 'order-123',
            message: 'Provider declined the application',
          }),
        },
      });
    });

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBe(
      'Provider declined the application'
    );
    expect(trackCheckoutPaymentFailed).toHaveBeenCalledWith(
      'bnpl_provider_error',
      'order-123',
      'credpal'
    );
    expect(trackCheckoutPaymentFailed).toHaveBeenCalledTimes(1);
  });

  it('emits payment_failed for terminal WebView load failures', async () => {
    mockRouteParams = {
      gateway: 'credit_direct',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
    };
    const { result } = renderControllerHook();

    await act(async () => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'bnpl_provider_opened',
            gateway: 'credit_direct',
            orderId: 'order-123',
          }),
        },
      });
    });
    act(() => {
      result.current.handleWebViewError({
        description: 'net::ERR_FAILED',
        url: 'https://pay.example/x',
      });
    });

    expect(result.current.status).toBe('error');
    expect(trackCheckoutPaymentFailed).toHaveBeenCalledWith(
      'bnpl_load_error',
      'order-123',
      'credit_direct'
    );
  });

  it('shows error UI without payment_failed for pre-open load failures', () => {
    mockRouteParams = {
      gateway: 'credit_direct',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
    };
    const { result } = renderControllerHook();

    // Offline/DNS failure before the provider opened: no payment_started
    // exists to match, so the funnel failure must not emit — but the
    // shopper still gets the error UI with retry.
    act(() => {
      result.current.handleWebViewError({
        description: 'net::ERR_INTERNET_DISCONNECTED',
        url: 'https://pay.example/x',
      });
    });

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBeTruthy();
    expect(trackCheckoutPaymentFailed).not.toHaveBeenCalled();
    expect(trackCheckoutPaymentStarted).not.toHaveBeenCalled();
  });

  it('shows error UI without payment_failed for a pre-open Klump load failure', () => {
    mockRouteParams = {
      gateway: 'klump',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
    };
    const { result } = renderControllerHook();

    // The launcher document fails before Klump's onOpen bridges: the
    // submit records no eager start anymore, so neither funnel event may
    // emit — but the shopper still gets the error UI with retry.
    act(() => {
      result.current.handleWebViewError({
        description: 'net::ERR_INTERNET_DISCONNECTED',
        url: 'https://pay.example/x',
      });
    });

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBeTruthy();
    expect(trackCheckoutPaymentFailed).not.toHaveBeenCalled();
    expect(trackCheckoutPaymentStarted).not.toHaveBeenCalled();
  });

  it('records a fresh start when a retried Klump attempt reopens', async () => {
    mockRouteParams = {
      gateway: 'klump',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
      amount: '21500',
    };
    const { result } = renderControllerHook();
    const openedMessage = {
      nativeEvent: {
        data: JSON.stringify({
          type: 'bnpl_provider_opened',
          gateway: 'klump',
          orderId: 'order-123',
        }),
      },
    };

    // First attempt opens (start recorded) then fails at load.
    await act(async () => {
      result.current.handleWebViewMessage(openedMessage);
    });
    act(() => {
      result.current.handleWebViewError({
        description: 'net::ERR_FAILED',
        url: 'https://pay.example/x',
      });
    });
    expect(trackCheckoutPaymentStarted).toHaveBeenCalledTimes(1);
    expect(trackCheckoutPaymentStarted).toHaveBeenCalledWith({
      orderId: 'order-123',
      paymentMethod: 'klump',
      value: 21500,
    });
    expect(result.current.status).toBe('error');

    // Retry resets the start guard, so the reopened Klump flow emits its
    // own start to match any later failure.
    act(() => {
      result.current.handleRetry();
    });
    await act(async () => {
      result.current.handleWebViewMessage(openedMessage);
    });

    expect(trackCheckoutPaymentStarted).toHaveBeenCalledTimes(2);
  });

  it('fails the checkout when the launch document returns an HTTP error', async () => {
    mockRouteParams = {
      gateway: 'credit_direct',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
    };
    const { result } = renderControllerHook();

    await act(async () => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'bnpl_provider_opened',
            gateway: 'credit_direct',
            orderId: 'order-123',
          }),
        },
      });
    });
    act(() => {
      result.current.handleWebViewHttpError({
        nativeEvent: {
          description: 'Internal Server Error',
          statusCode: 500,
          url: result.current.bnplUrl,
        },
      } as never);
    });

    // The provider error page is unusable: surface retry UI and record
    // the attempt-scoped failure instead of letting load-end mark ready.
    expect(result.current.status).toBe('error');
    expect(trackCheckoutPaymentFailed).toHaveBeenCalledWith(
      'bnpl_load_error',
      'order-123',
      'credit_direct'
    );
    expect(trackCheckoutPaymentCompletedOnce).not.toHaveBeenCalled();
  });

  it('shows error UI without payment_failed for pre-open HTTP failures', () => {
    mockRouteParams = {
      gateway: 'credit_direct',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
    };
    const { result } = renderControllerHook();

    // The launch document 500s before the provider opened: retry UI
    // surfaces, but no funnel failure emits without a matching start.
    act(() => {
      result.current.handleWebViewHttpError({
        nativeEvent: {
          description: 'Internal Server Error',
          statusCode: 500,
          url: result.current.bnplUrl,
        },
      } as never);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBeTruthy();
    expect(trackCheckoutPaymentFailed).not.toHaveBeenCalled();
    expect(trackCheckoutPaymentCompletedOnce).not.toHaveBeenCalled();
  });

  it('fails the checkout when an allowed redirect target returns an HTTP error', async () => {
    mockRouteParams = {
      gateway: 'credit_direct',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
    };
    const { result } = renderControllerHook('ogabassey.com');
    const providerUrl =
      'https://ogabassey.com/checkout/bnpl?gateway=credit_direct&orderId=order-123';

    await act(async () => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'bnpl_provider_opened',
            gateway: 'credit_direct',
            orderId: 'order-123',
          }),
        },
      });
    });

    let shouldStart = false;
    act(() => {
      shouldStart = result.current.handleShouldStartLoadWithRequest({
        canGoBack: false,
        canGoForward: false,
        isTopFrame: true,
        loading: true,
        lockIdentifier: 1,
        navigationType: 'other',
        title: 'BNPL checkout',
        url: providerUrl,
      } as never);
    });
    expect(shouldStart).toBe(true);

    // The accepted top-frame navigation became the document: its HTTP
    // failure must not be misclassified as a subresource error against
    // the stale launcher URL.
    act(() => {
      result.current.handleWebViewHttpError({
        nativeEvent: {
          description: 'Not Found',
          statusCode: 404,
          url: providerUrl,
        },
      } as never);
    });

    expect(result.current.status).toBe('error');
    expect(trackCheckoutPaymentFailed).toHaveBeenCalledWith(
      'bnpl_load_error',
      'order-123',
      'credit_direct'
    );
  });

  it('ignores subresource HTTP errors while the document loads', () => {
    mockRouteParams = {
      gateway: 'credit_direct',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
    };
    const { result } = renderControllerHook();

    act(() => {
      result.current.handleWebViewHttpError({
        nativeEvent: {
          description: 'Not Found',
          statusCode: 404,
          url: 'https://cdn.example/assets/banner.png',
        },
      } as never);
    });

    expect(result.current.status).not.toBe('error');
    expect(trackCheckoutPaymentFailed).not.toHaveBeenCalled();
  });

  it('ignores late errors arriving after successful completion', async () => {
    mockRouteParams = {
      gateway: 'credit_direct',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
      trackingToken: 'track-token-123',
    };
    const { result } = renderControllerHook();

    await act(async () => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'navigation',
            url: 'https://usebaci.com/ogabassey/order-success?reference=BAC-123',
          }),
        },
      });
    });
    expect(result.current.status).toBe('success');
    expect(trackCheckoutPaymentCompletedOnce).toHaveBeenCalledTimes(1);

    // A late aborted-load error (and a late provider error redirect) while
    // the success navigation is replaced must not flip the paid checkout
    // back to error or emit payment_failed beside the completion.
    act(() => {
      result.current.handleWebViewError({
        description: 'net::ERR_ABORTED',
        url: 'https://usebaci.com/ogabassey/order-success?reference=BAC-123',
      });
    });
    await act(async () => {
      result.current.handleWebViewMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'navigation',
            url: 'https://usebaci.com/ogabassey/checkout?error=declined',
          }),
        },
      });
    });

    expect(result.current.status).toBe('success');
    expect(trackCheckoutPaymentFailed).not.toHaveBeenCalled();
    expect(trackCheckoutPaymentCompletedOnce).toHaveBeenCalledTimes(1);
  });

  it('dedupes duplicate failure callbacks after rerender until Retry', async () => {
    mockRouteParams = {
      gateway: 'credit_direct',
      merchantSlug: 'ogabassey',
      orderId: 'order-123',
    };
    const { result, rerender } = renderControllerHook();
    const errorMessage = {
      nativeEvent: {
        data: JSON.stringify({
          type: 'navigation',
          url: 'https://usebaci.com/ogabassey/checkout?error=declined',
        }),
      },
    } as Parameters<typeof result.current.handleWebViewMessage>[0];

    await act(async () => {
      result.current.handleWebViewMessage(errorMessage);
    });
    // The error status triggers a rerender; a repeated provider callback
    // for the same URL must not emit a second payment_failed.
    rerender({});
    await act(async () => {
      result.current.handleWebViewMessage(errorMessage);
    });
    act(() => {
      result.current.handleWebViewError({
        description: 'net::ERR_FAILED',
        url: 'https://pay.example/x',
      });
    });

    expect(trackCheckoutPaymentFailed).toHaveBeenCalledTimes(1);

    // Retry opens a fresh attempt: the next failure is recorded again.
    act(() => {
      result.current.handleRetry();
    });
    await act(async () => {
      result.current.handleWebViewMessage(errorMessage);
    });

    expect(trackCheckoutPaymentFailed).toHaveBeenCalledTimes(2);
  });
});
