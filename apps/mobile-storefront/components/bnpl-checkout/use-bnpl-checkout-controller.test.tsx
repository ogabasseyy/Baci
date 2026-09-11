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
import { BNPL_UNTRUSTED_POPUP_MESSAGE } from './bnpl-checkout.helpers';
import { useBNPLCheckoutController } from './use-bnpl-checkout-controller';

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
  useCartStore: (selector: (state: { clearCart: () => void }) => unknown) =>
    selector({ clearCart: mockClearCart }),
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
});
