import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetKlumpSdkLoadForTests } from '@/lib/klump-sdk';
import { BnplLauncher, KLUMP_REDIRECT_URL_KEY } from './bnpl-launcher';
import {
  CREDIT_DIRECT_POPUP_MARKER_PREFIX,
  readCreditDirectPopupMarker,
} from './checkout/credit-direct-popup-return';
import { CHECKOUT_IDEMPOTENCY_STORAGE_KEY } from './checkout/checkout-idempotency';
import { CHECKOUT_PENDING_ORDER_STORAGE_KEY } from './checkout/pending-checkout-order';

const mockClearCart = vi.hoisted(() => vi.fn());
const mockPush = vi.fn();
const mockRouter = { push: mockPush };
const mockSearchParams = vi.fn();
const mockOpenCreditDirectCheckout = vi.fn();
const mockOpenCredPalCheckout = vi.fn();
const mockApiPost = vi.fn();
const mockKlumpConstructor = vi.fn();

interface TestReactNativeWebViewWindow extends Window {
  ReactNativeWebView?: {
    postMessage: (message: string) => void;
  };
}

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => mockRouter),
  useSearchParams: vi.fn(() => mockSearchParams()),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: vi.fn(() => ({
    merchant: { slug: 'test-store' },
    loading: false,
  })),
}));

vi.mock('@/hooks/cart', () => ({
  useCartSafe: () => ({ clearCart: mockClearCart }),
}));

vi.mock('@/lib/credit-direct-client', () => ({
  openCreditDirectCheckout: (...args: unknown[]) =>
    mockOpenCreditDirectCheckout(...args),
}));

vi.mock('@/lib/credpal', () => ({
  openCredPalCheckout: (...args: unknown[]) =>
    mockOpenCredPalCheckout(...args),
  getCredPalKey: vi.fn(() => 'credpal_test_key'),
}));

vi.mock('@/lib/api-client', () => ({
  apiPost: (...args: unknown[]) => mockApiPost(...args),
  fetchWithCsrf: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
}));

const mockCaptureCheckoutFunnelEventOnce = vi.fn();
const mockCaptureClientEvent = vi.fn();

vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: (...args: unknown[]) =>
    mockCaptureCheckoutFunnelEventOnce(...args),
}));

vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: (...args: unknown[]) =>
    mockCaptureClientEvent(...args),
}));

describe('BnplLauncher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenCreditDirectCheckout.mockReset();
    mockOpenCredPalCheckout.mockReset();
    window.history.replaceState({}, '', '/checkout/bnpl');
    window.sessionStorage.clear();
    window.localStorage.clear();
    Reflect.deleteProperty(window, 'ReactNativeWebView');
    document
      .querySelectorAll('script[src="https://js.useklump.com/klump.js"]')
      .forEach((script) => script.remove());
    document
      .querySelectorAll('#klump_checkout, #klump__checkout')
      .forEach((element) => element.remove());
    delete (window as TestReactNativeWebViewWindow).ReactNativeWebView;
    resetKlumpSdkLoadForTests();
    window.Klump = mockKlumpConstructor as never;
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'credit_direct',
        merchant_slug: 'test-store',
        trackingToken: 'tok-123',
      })
    );
    mockApiPost.mockResolvedValue({ success: true });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'order-1',
          tracking_token: 'track-order-token',
          total: 1000,
          customer_email: 'customer@example.com',
          customer_phone: '08012345678',
          customer_name: 'John Doe',
          items: [
            {
              product_id: 'product-1',
              name: 'Capsule',
              price: 1000,
              quantity: 1,
            },
          ],
        }),
      })
    );
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('loads BNPL order details once across launcher status transitions', async () => {
    render(<BnplLauncher />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/storefront/orders/order-1?merchant_slug=test-store&token=tok-123'
      );
    });
    await waitFor(() => {
      expect(mockOpenCreditDirectCheckout).toHaveBeenCalledOnce();
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('includes a persisted customer email alongside the tracking token when available', async () => {
    window.sessionStorage.setItem(
      CHECKOUT_PENDING_ORDER_STORAGE_KEY,
      JSON.stringify({
        orderId: 'order-1',
        trackingToken: 'tok-123',
        customerEmail: 'customer@example.com',
      })
    );

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/storefront/orders/order-1?merchant_slug=test-store&token=tok-123&email=customer%40example.com'
      );
    });
  });

  it('falls back to the stored pending-order tracking token for legacy links', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'credit_direct',
        merchant_slug: 'test-store',
      })
    );
    window.sessionStorage.setItem(
      CHECKOUT_PENDING_ORDER_STORAGE_KEY,
      JSON.stringify({
        orderId: 'order-1',
        trackingToken: 'stored-track-token',
      })
    );

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/storefront/orders/order-1?merchant_slug=test-store&token=stored-track-token'
      );
    });
  });

  it('verifies an in-page Credit Direct success before redirecting', async () => {
    mockOpenCreditDirectCheckout.mockImplementation(({ onSuccess }) => {
      onSuccess({
        checkoutTransactionId: 'ref-1',
        sessionId: 'signed-session-1',
      });
      return Promise.resolve();
    });

    render(<BnplLauncher />);

    expect(
      await screen.findByRole('heading', { name: 'Confirming your payment' })
    ).toBeInTheDocument();
    expect(readCreditDirectPopupMarker('order-1')?.transactionId).toBe('ref-1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/orders/credit-direct/client-completion',
      {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: 'order-1',
          checkoutTransactionId: 'ref-1',
          customerEmail: 'customer@example.com',
          sessionId: 'signed-session-1',
          tracking_token: 'track-order-token',
        }),
      }
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('labels a signed-session-only success without inventing a transaction id', async () => {
    mockOpenCreditDirectCheckout.mockImplementation(({ onSuccess }) => {
      onSuccess({
        checkoutTransactionId: null,
        sessionId: 'signed-session-only',
      });
      return Promise.resolve();
    });

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(readCreditDirectPopupMarker('order-1')?.transactionId).toBe(
        'signed-session-only'
      );
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/orders/credit-direct/client-completion',
      {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: 'order-1',
          customerEmail: 'customer@example.com',
          sessionId: 'signed-session-only',
          tracking_token: 'track-order-token',
        }),
      }
    );
  });

  it('normalizes string order totals before signing Credit Direct checkout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'order-1',
          tracking_token: 'track-order-token',
          total: '349613.00',
          customer_email: 'customer@example.com',
          customer_phone: '08012345678',
          customer_name: 'John Doe',
          items: [
            {
              product_id: 'product-1',
              name: 'Capsule',
              price: 349613,
              quantity: 1,
            },
          ],
        }),
      })
    );
    mockOpenCreditDirectCheckout.mockResolvedValue(undefined);

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockOpenCreditDirectCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 349613 })
      );
    });
  });

  it('uses pending checkout contact details when public order data is redacted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'order-1',
          tracking_token: 'track-order-token',
          total: 1000,
          customer_email: 'cu***@example.com',
          customer_phone: '+2**********78',
          customer_name: 'John Doe',
          items: [
            {
              product_id: 'product-1',
              name: 'Capsule',
              price: 1000,
              quantity: 1,
            },
          ],
        }),
      })
    );
    window.sessionStorage.setItem(
      CHECKOUT_PENDING_ORDER_STORAGE_KEY,
      JSON.stringify({
        orderId: 'order-1',
        trackingToken: 'tok-123',
        customerEmail: 'customer@example.com',
        customerPhone: '+2348012345678',
      })
    );
    mockOpenCreditDirectCheckout.mockResolvedValue(undefined);

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockOpenCreditDirectCheckout).toHaveBeenCalledWith(
        expect.objectContaining({
          customerEmail: 'customer@example.com',
          customerPhone: '+2348012345678',
        })
      );
    });
  });

  it('rejects invalid Credit Direct order totals before opening checkout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'order-1',
          tracking_token: 'track-order-token',
          total: 'not-a-number',
          customer_email: 'customer@example.com',
          customer_phone: '08012345678',
          customer_name: 'John Doe',
          items: [
            {
              product_id: 'product-1',
              name: 'Capsule',
              price: 1000,
              quantity: 1,
            },
          ],
        }),
      })
    );

    render(<BnplLauncher />);

    expect(
      await screen.findByText('Invalid order total for Credit Direct checkout.')
    ).toBeInTheDocument();
    expect(mockOpenCreditDirectCheckout).not.toHaveBeenCalled();
  });

  it('stores Credit Direct popup transaction ids with the public tracking token', async () => {
    mockOpenCreditDirectCheckout.mockImplementation(({ onPopup }) => {
      onPopup({
        checkoutTransactionId: 'cd-popup-transaction-1',
        sessionId: 'signed-session-1',
      });
      return Promise.resolve();
    });

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        '/api/orders/update-payment-ref',
        {
          gateway: 'credit_direct',
          orderId: 'order-1',
          paymentRef: 'cd-popup-transaction-1',
          tracking_token: 'track-order-token',
        }
      );
    });
  });

  it('keeps a session-only popup marker without persisting it as a transaction id', async () => {
    mockOpenCreditDirectCheckout.mockImplementation(({ onPopup }) => {
      onPopup({
        checkoutTransactionId: null,
        sessionId: 'signed-session-only',
      });
      return Promise.resolve();
    });

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(readCreditDirectPopupMarker('order-1')?.transactionId).toBe(
        'signed-session-only'
      );
    });
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('bridges Credit Direct close events to React Native without rendering cancellation UI', async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage },
    });
    mockOpenCreditDirectCheckout.mockImplementation(({ onClose }) => {
      onClose();
      return Promise.resolve();
    });

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        JSON.stringify({
          gateway: 'credit_direct',
          message: 'Credit Direct checkout closed',
          type: 'bnpl_close',
        })
      );
    });
    expect(
      screen.queryByText('Payment cancelled. Please try again.')
    ).not.toBeInTheDocument();
  });

  it('bridges an opened CredPal SDK failure to React Native without rendering error UI', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'credpal',
        merchant_slug: 'test-store',
        trackingToken: 'tok-123',
      })
    );
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage },
    });
    mockOpenCredPalCheckout.mockImplementation(({ onLoad, onError }) => {
      onLoad();
      onError({ success: false, message: 'Provider declined' });
      return Promise.resolve();
    });

    render(<BnplLauncher />);

    // Opened first (start recorded natively), then the SDK failure must
    // reach the native failure recorder instead of stranding the start.
    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        JSON.stringify({
          gateway: 'credpal',
          orderId: 'order-1',
          type: 'bnpl_provider_opened',
        })
      );
    });
    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        JSON.stringify({
          gateway: 'credpal',
          orderId: 'order-1',
          message: 'Provider declined',
          type: 'bnpl_provider_error',
        })
      );
    });
    expect(screen.queryByText('Provider declined')).not.toBeInTheDocument();
  });

  it('keeps a pre-popup Credit Direct SDK failure local instead of bridging it', async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage },
    });
    mockOpenCreditDirectCheckout.mockImplementation(({ onError }) => {
      onError('Credit Direct unavailable');
      return Promise.resolve();
    });

    render(<BnplLauncher />);

    // No popup ever opened, so no native payment_started exists to match:
    // the failure must stay local instead of bridging an unmatched error.
    expect(await screen.findByText('Credit Direct unavailable')).toBeInTheDocument();
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('bnpl_provider_error')
    );
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('bnpl_provider_opened')
    );
  });

  it('bridges an opened-then-failed Credit Direct attempt to React Native', async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage },
    });
    mockOpenCreditDirectCheckout.mockImplementation(({ onPopup, onError }) => {
      void onPopup({
        checkoutTransactionId: 'cd-popup-bridge-1',
        sessionId: 'signed-session-bridge-1',
      }).then(() => {
        onError('Credit Direct unavailable');
      });
      return Promise.resolve();
    });

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        JSON.stringify({
          gateway: 'credit_direct',
          orderId: 'order-1',
          type: 'bnpl_provider_opened',
        })
      );
    });
    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        JSON.stringify({
          gateway: 'credit_direct',
          orderId: 'order-1',
          message: 'Credit Direct unavailable',
          type: 'bnpl_provider_error',
        })
      );
    });
    expect(
      screen.queryByText('Credit Direct unavailable')
    ).not.toBeInTheDocument();
  });

  it('logs and continues when Credit Direct popup reference persistence fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockApiPost.mockRejectedValueOnce(new Error('Update failed'));
    mockOpenCreditDirectCheckout.mockImplementation(({ onPopup }) => {
      onPopup({
        checkoutTransactionId: 'cd-popup-transaction-1',
        sessionId: 'signed-session-1',
      });
      return Promise.resolve();
    });

    try {
      render(<BnplLauncher />);

      await waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          'Failed to persist Credit Direct popup reference:',
          'Update failed'
        );
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('preserves trackingToken when redirecting after CredPal success', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'credpal',
        merchant_slug: 'test-store',
        trackingToken: 'tok-123',
      })
    );
    mockOpenCredPalCheckout.mockImplementation(({ onSuccess }) => {
      onSuccess({ order_no: 'credpal-ref-1' });
      return Promise.resolve();
    });

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        '/order-success?orderId=order-1&reference=credpal-ref-1&type=credpal&trackingToken=track-order-token'
      );
    });
  });

  it('records a paid conversion only for approved CredPal results', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'credpal',
        merchant_slug: 'test-store',
        trackingToken: 'tok-123',
      })
    );
    mockOpenCredPalCheckout.mockImplementation(({ onSuccess }) => {
      onSuccess({ order_no: 'credpal-ref-1', status: 'success' });
      return Promise.resolve();
    });

    render(<BnplLauncher />);

    await waitFor(() =>
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        'order-1',
        expect.objectContaining({ payment_status: 'paid' })
      )
    );
  });

  it('suppresses web attribution inside a native BNPL WebView', async () => {
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage: vi.fn() },
    });
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'credpal',
        merchant_slug: 'test-store',
        trackingToken: 'tok-123',
      })
    );
    mockOpenCredPalCheckout.mockImplementation(({ onSuccess }) => {
      onSuccess({ order_no: 'credpal-ref-1', status: 'success' });
      return Promise.resolve();
    });

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        '/order-success?orderId=order-1&reference=credpal-ref-1&type=credpal&credpalStatus=success&trackingToken=track-order-token'
      );
    });
    expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
      'payment_completed',
      expect.anything(),
      expect.anything()
    );
  });

  it('skips the paid conversion for pending CredPal applications', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'credpal',
        merchant_slug: 'test-store',
        trackingToken: 'tok-123',
      })
    );
    mockOpenCredPalCheckout.mockImplementation(({ onSuccess }) => {
      onSuccess({ order_no: 'credpal-ref-1', status: 'pending' });
      return Promise.resolve();
    });

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        '/order-success?orderId=order-1&reference=credpal-ref-1&type=credpal&credpalStatus=pending&trackingToken=track-order-token'
      );
    });
    expect(mockCaptureCheckoutFunnelEventOnce).not.toHaveBeenCalledWith(
      'payment_completed',
      expect.anything(),
      expect.anything()
    );
  });

  it('posts CredPal close events to the native WebView bridge', async () => {
    const postMessage = vi.fn();
    (window as TestReactNativeWebViewWindow).ReactNativeWebView = {
      postMessage,
    };
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'credpal',
        merchant_slug: 'test-store',
        trackingToken: 'tok-123',
      })
    );
    mockOpenCredPalCheckout.mockImplementation(({ onClose }) => {
      onClose();
      return Promise.resolve();
    });

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        JSON.stringify({
          gateway: 'credpal',
          message: 'CredPal checkout closed',
          type: 'bnpl_close',
        })
      );
    });
    expect(screen.queryByText('Payment cancelled.')).not.toBeInTheDocument();
  });

  it('posts a provider-opened signal when the CredPal widget loads', async () => {
    const postMessage = vi.fn();
    (window as TestReactNativeWebViewWindow).ReactNativeWebView = {
      postMessage,
    };
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'credpal',
        merchant_slug: 'test-store',
        trackingToken: 'tok-123',
      })
    );
    mockOpenCredPalCheckout.mockImplementation(({ onLoad }) => {
      onLoad();
      return Promise.resolve();
    });

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        JSON.stringify({
          gateway: 'credpal',
          orderId: 'order-1',
          type: 'bnpl_provider_opened',
        })
      );
    });
  });

  it('keeps the web CredPal cancellation fallback when no native bridge exists', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'credpal',
        merchant_slug: 'test-store',
        trackingToken: 'tok-123',
      })
    );
    mockOpenCredPalCheckout.mockImplementation(({ onClose }) => {
      onClose();
      return Promise.resolve();
    });

    render(<BnplLauncher />);

    expect(await screen.findByText('Payment cancelled.')).toBeInTheDocument();
  });

  it('keeps the web CredPal cancellation fallback when native close posting fails', async () => {
    (window as TestReactNativeWebViewWindow).ReactNativeWebView = {
      postMessage: vi.fn(() => {
        throw new Error('native bridge unavailable');
      }),
    };
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'credpal',
        merchant_slug: 'test-store',
        trackingToken: 'tok-123',
      })
    );
    mockOpenCredPalCheckout.mockImplementation(({ onClose }) => {
      onClose();
      return Promise.resolve();
    });

    render(<BnplLauncher />);

    expect(await screen.findByText('Payment cancelled.')).toBeInTheDocument();
  });

  it('launches Klump checkout with BAC reference and callback route', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
      })
    );
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'order-1',
          tracking_token: 'track-order-token',
          shipping_cost: 2726,
          total: 58088.5,
          customer_email: 'cu***@example.com',
          customer_phone: '+2**********78',
          customer_name: 'John Doe',
          items: [
            {
              product_id: 'product-1',
              name: 'Capsule',
              price: 51500,
              quantity: 1,
            },
          ],
        }),
      })
    );
    window.sessionStorage.setItem(
      CHECKOUT_PENDING_ORDER_STORAGE_KEY,
      JSON.stringify({
        orderId: 'order-1',
        trackingToken: 'tok-123',
        customerEmail: 'customer@example.com',
        customerPhone: '+234 0801 234 5678',
      })
    );

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockKlumpConstructor).toHaveBeenCalled();
    });
    expect(document.getElementById('klump__checkout')).toBeInTheDocument();

    const config = mockKlumpConstructor.mock.calls[0][0] as {
      data: {
        amount: number;
        email: string;
        items: Array<{
          name: string;
          quantity: number;
          unit_price: number;
        }>;
        merchant_reference: string;
        phone: string;
        redirect_url: string;
      };
      onClose?: () => void;
      onLoad?: () => void;
      onSuccess?: () => void;
      publicKey: string;
    };

    expect(config.publicKey).toBe('klp_pk_test_123');
    expect(config.onLoad).toEqual(expect.any(Function));
    expect(config.onSuccess).toEqual(expect.any(Function));
    expect(config.data.amount).toBe(58089);
    expect(config.data.email).toBe('customer@example.com');
    expect(config.data.items).toEqual([
      { name: 'Capsule', quantity: 1, unit_price: 51500 },
      { name: 'Delivery', quantity: 1, unit_price: 2726 },
      { name: 'Taxes and fees', quantity: 1, unit_price: 3863 },
    ]);
    expect(config.data.merchant_reference).toBe('BAC-ABCD12345678');
    expect(config.data.phone).toBe('08012345678');
    expect(config.data.redirect_url).toContain('/checkout/bnpl?');
    expect(config.data.redirect_url).not.toContain('/test-store/checkout/bnpl?');
    expect(config.data.redirect_url).toContain('gateway=klump');
    expect(config.data.redirect_url).toContain('klump_callback=1');
    expect(config.data.redirect_url).toContain('reference=BAC-ABCD12345678');
    expect(config.data.redirect_url).toContain('type=klump');

    const klumpCheckoutFrame = document.createElement('iframe');
    klumpCheckoutFrame.id = 'klump_checkout';
    document.body.appendChild(klumpCheckoutFrame);
    config.onClose?.();
    await waitFor(() => {
      expect(
        screen.queryByText('Payment cancelled. Please try again.')
      ).not.toBeInTheDocument();
    });
  });

  it('shows a Klump invalid-total error without using the generic launch error path', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
      })
    );
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'order-1',
          tracking_token: 'track-order-token',
          total: 'not-a-number',
          customer_email: 'customer@example.com',
          customer_phone: '08012345678',
          customer_name: 'John Doe',
          items: [
            {
              product_id: 'product-1',
              name: 'Capsule',
              price: 1000,
              quantity: 1,
            },
          ],
        }),
      })
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const appendScriptSpy = vi.spyOn(document.head, 'appendChild');
    window.Klump = undefined;

    try {
      render(<BnplLauncher />);

      expect(
        await screen.findByText('Invalid order total for Klump checkout.')
      ).toBeInTheDocument();
      expect(mockKlumpConstructor).not.toHaveBeenCalled();
      expect(appendScriptSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      appendScriptSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('does not mark Klump checkout cancelled when success redirect is pending', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
      })
    );
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockKlumpConstructor).toHaveBeenCalled();
    });

    const config = mockKlumpConstructor.mock.calls[0][0] as {
      data: { redirect_url: string };
      onClose?: () => void;
      onSuccess?: () => void;
    };
    config.onSuccess?.();
    window.localStorage.setItem(KLUMP_REDIRECT_URL_KEY, config.data.redirect_url);
    config.onClose?.();

    await waitFor(() => {
      expect(
        screen.queryByText('Payment cancelled. Please try again.')
      ).not.toBeInTheDocument();
    });
  });

  it('does not mark Klump checkout cancelled when the SDK redirect key is pending', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
      })
    );
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockKlumpConstructor).toHaveBeenCalled();
    });

    const config = mockKlumpConstructor.mock.calls[0][0] as {
      data: { redirect_url: string };
      onClose?: () => void;
    };
    window.localStorage.setItem(KLUMP_REDIRECT_URL_KEY, config.data.redirect_url);
    config.onClose?.();

    await waitFor(() => {
      expect(
        screen.queryByText('Payment cancelled. Please try again.')
      ).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(window.localStorage.getItem(KLUMP_REDIRECT_URL_KEY)).toBeNull();
    });
  });

  it('bridges Klump close events to React Native without rendering cancellation UI', async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage },
    });
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
      })
    );
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockKlumpConstructor).toHaveBeenCalled();
    });

    const config = mockKlumpConstructor.mock.calls[0][0] as {
      onClose?: () => void;
    };
    config.onClose?.();

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        JSON.stringify({
          gateway: 'klump',
          message: 'Klump checkout closed',
          type: 'bnpl_close',
        })
      );
    });
    expect(
      screen.queryByText('Payment cancelled. Please try again.')
    ).not.toBeInTheDocument();
  });

  it('posts a provider-opened signal when the Klump widget opens', async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage },
    });
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
      })
    );
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockKlumpConstructor).toHaveBeenCalled();
    });
    // Constructing the widget must not signal opened: only onOpen proves
    // the provider UI actually opened.
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('bnpl_provider_opened')
    );

    const config = mockKlumpConstructor.mock.calls[0][0] as {
      onOpen?: () => void;
    };
    config.onOpen?.();

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        JSON.stringify({
          gateway: 'klump',
          orderId: 'order-1',
          type: 'bnpl_provider_opened',
        })
      );
    });
  });

  it('bridges an opened-then-failed Klump attempt to React Native', async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage },
    });
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
      })
    );
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockKlumpConstructor).toHaveBeenCalled();
    });

    const config = mockKlumpConstructor.mock.calls[0][0] as {
      onOpen?: () => void;
      onError?: (error: Error) => void;
    };
    config.onOpen?.();
    config.onError?.(new Error('Klump declined the application'));

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        JSON.stringify({
          gateway: 'klump',
          orderId: 'order-1',
          type: 'bnpl_provider_opened',
        })
      );
    });
    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        JSON.stringify({
          gateway: 'klump',
          orderId: 'order-1',
          message: 'Klump declined the application',
          type: 'bnpl_provider_error',
        })
      );
    });
    expect(
      screen.queryByText('Klump declined the application')
    ).not.toBeInTheDocument();
    // The native shell attributes the bridged failure: no web event.
    expect(mockCaptureClientEvent).not.toHaveBeenCalledWith(
      'payment_failed',
      expect.anything()
    );
  });

  it('keeps a pre-open Klump SDK failure local instead of bridging it', async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage },
    });
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
      })
    );
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockKlumpConstructor).toHaveBeenCalled();
    });

    // onOpen never fired, so no native payment_started exists to match:
    // the failure must stay local instead of bridging an unmatched error.
    const config = mockKlumpConstructor.mock.calls[0][0] as {
      onError?: (error: Error) => void;
    };
    config.onError?.(new Error('Klump unavailable'));

    expect(await screen.findByText('Klump unavailable')).toBeInTheDocument();
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('bnpl_provider_error')
    );
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('bnpl_provider_opened')
    );
  });

  it('records the deferred web start when the Klump widget opens in a browser', async () => {
    // No native bridge: an ordinary browser session.
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
      })
    );
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'order-1',
          order_number: 'BAC-001',
          total: 58088.5,
          currency: 'NGN',
          customer_email: 'customer@example.com',
          customer_phone: '08012345678',
          customer_name: 'John Doe',
          items: [
            {
              product_id: 'product-1',
              name: 'Capsule',
              price: 51500,
              quantity: 1,
            },
          ],
        }),
      })
    );

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockKlumpConstructor).toHaveBeenCalled();
    });
    // Constructing the widget opens nothing yet: no web start.
    expect(mockCaptureClientEvent).not.toHaveBeenCalledWith(
      'payment_started',
      expect.anything()
    );

    const config = mockKlumpConstructor.mock.calls[0][0] as {
      onOpen?: () => void;
    };
    config.onOpen?.();

    await waitFor(() => {
      expect(mockCaptureClientEvent).toHaveBeenCalledWith(
        'payment_started',
        expect.objectContaining({
          channel: 'web',
          currency: 'NGN',
          order_id: 'order-1',
          order_number: 'BAC-001',
          payment_intent: 'installments',
          payment_method: 'klump',
          source: 'web_checkout',
          total: 58088.5,
        })
      );
    });
  });

  it('records no web start when the Klump SDK fails to load in a browser', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
      })
    );
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');
    vi.stubGlobal('Klump', undefined);
    window.Klump = undefined;

    const originalAppendChild = document.head.appendChild.bind(document.head);
    const appendSpy = vi
      .spyOn(document.head, 'appendChild')
      .mockImplementation(<T extends Node>(node: T): T => {
        const result = originalAppendChild(node);
        if (
          node instanceof HTMLScriptElement &&
          node.src === 'https://js.useklump.com/klump.js'
        ) {
          queueMicrotask(() => node.dispatchEvent(new Event('error')));
        }
        return result;
      });

    try {
      render(<BnplLauncher />);

      expect(
        await screen.findByRole('heading', { name: 'Something went wrong' })
      ).toBeInTheDocument();
      expect(mockKlumpConstructor).not.toHaveBeenCalled();
      // Pre-open failure: the widget never opened, so no web start may
      // exist to strand unmatched.
      expect(mockCaptureClientEvent).not.toHaveBeenCalledWith(
        'payment_started',
        expect.anything()
      );
    } finally {
      appendSpy.mockRestore();
    }
  });

  it('records a web failure for an opened-then-failed browser Klump attempt', async () => {
    // No native bridge: an ordinary browser session.
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
      })
    );
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockKlumpConstructor).toHaveBeenCalled();
    });

    const config = mockKlumpConstructor.mock.calls[0][0] as {
      onOpen?: () => void;
      onError?: (error: Error) => void;
    };
    config.onOpen?.();
    // Checkout already navigated to the launcher: nothing else can close
    // the onOpen start, so the failure must record here.
    config.onError?.(new Error('Klump declined the application'));

    await waitFor(() => {
      expect(mockCaptureClientEvent).toHaveBeenCalledWith(
        'payment_started',
        expect.objectContaining({ payment_method: 'klump' })
      );
    });
    await waitFor(() => {
      expect(mockCaptureClientEvent).toHaveBeenCalledWith(
        'payment_failed',
        expect.objectContaining({
          order_id: 'order-1',
          payment_method: 'klump',
          reason: 'klump_error',
        })
      );
    });
    expect(
      await screen.findByText('Klump declined the application')
    ).toBeInTheDocument();
  });

  it('records no web failure for a pre-open browser Klump error', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
      })
    );
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockKlumpConstructor).toHaveBeenCalled();
    });

    // onOpen never fired: no start exists, so the failure stays local.
    const config = mockKlumpConstructor.mock.calls[0][0] as {
      onError?: (error: Error) => void;
    };
    config.onError?.(new Error('Klump unavailable'));

    expect(await screen.findByText('Klump unavailable')).toBeInTheDocument();
    expect(mockCaptureClientEvent).not.toHaveBeenCalledWith(
      'payment_failed',
      expect.anything()
    );
    expect(mockCaptureClientEvent).not.toHaveBeenCalledWith(
      'payment_started',
      expect.anything()
    );
  });

  it('skips the web start for Klump opens inside a native shell', async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage },
    });
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
      })
    );
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockKlumpConstructor).toHaveBeenCalled();
    });

    const config = mockKlumpConstructor.mock.calls[0][0] as {
      onOpen?: () => void;
    };
    config.onOpen?.();

    // The native shell records the start from the bridge: a web event
    // here would double-attribute.
    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        JSON.stringify({
          gateway: 'klump',
          orderId: 'order-1',
          type: 'bnpl_provider_opened',
        })
      );
    });
    expect(mockCaptureClientEvent).not.toHaveBeenCalledWith(
      'payment_started',
      expect.anything()
    );
  });

  it('marks Klump checkout cancelled when the stored SDK redirect belongs to a previous checkout', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
      })
    );
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');
    window.localStorage.setItem(
      KLUMP_REDIRECT_URL_KEY,
      'https://ogabassey.com/checkout/bnpl?gateway=klump&orderId=old-order&klump_callback=1'
    );

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockKlumpConstructor).toHaveBeenCalled();
    });

    const config = mockKlumpConstructor.mock.calls[0][0] as {
      onClose?: () => void;
    };
    config.onClose?.();

    await waitFor(() => {
      expect(
        screen.getByText('Payment cancelled. Please try again.')
      ).toBeInTheDocument();
    });
  });

  it('clears a stale matching Klump redirect before a new checkout cancellation', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
      })
    );
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');
    const staleRedirectUrl =
      'http://localhost:3000/checkout/bnpl?gateway=klump&klump_callback=1&merchant_slug=test-store&orderId=order-1&reference=BAC-ABCD12345678&type=klump&trackingToken=tok-123';
    window.localStorage.setItem(KLUMP_REDIRECT_URL_KEY, staleRedirectUrl);

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockKlumpConstructor).toHaveBeenCalled();
    });

    const config = mockKlumpConstructor.mock.calls[0][0] as {
      onClose?: () => void;
    };
    config.onClose?.();

    await waitFor(() => {
      expect(
        screen.getByText('Payment cancelled. Please try again.')
      ).toBeInTheDocument();
    });
    expect(window.localStorage.getItem(KLUMP_REDIRECT_URL_KEY)).toBeNull();
  });

  it('uses the Klump global binding when the SDK does not attach itself to window', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
      })
    );
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');
    window.Klump = undefined;
    vi.stubGlobal('Klump', mockKlumpConstructor);

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockKlumpConstructor).toHaveBeenCalled();
    });
  });

  it('shows an error when the Klump SDK script fails to load', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
      })
    );
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');
    vi.stubGlobal('Klump', undefined);
    window.Klump = undefined;

    const originalAppendChild = document.head.appendChild.bind(document.head);
    const appendSpy = vi
      .spyOn(document.head, 'appendChild')
      .mockImplementation(<T extends Node>(node: T): T => {
        const result = originalAppendChild(node);
        if (
          node instanceof HTMLScriptElement &&
          node.src === 'https://js.useklump.com/klump.js'
        ) {
          queueMicrotask(() => node.dispatchEvent(new Event('error')));
        }
        return result;
      });

    try {
      render(<BnplLauncher />);

      expect(
        await screen.findByRole('heading', { name: 'Something went wrong' })
      ).toBeInTheDocument();
      expect(
        await screen.findByText('Failed to load Klump script')
      ).toBeInTheDocument();
      expect(appendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          src: 'https://js.useklump.com/klump.js',
        })
      );
    } finally {
      appendSpy.mockRestore();
    }
  });

  it('loads the Klump SDK script when no constructor is available yet', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
      })
    );
    vi.stubEnv('NEXT_PUBLIC_KLUMP_PUBLIC_KEY', 'klp_pk_test_123');
    vi.stubGlobal('Klump', undefined);
    window.Klump = undefined;

    const originalAppendChild = document.head.appendChild.bind(document.head);
    const appendSpy = vi
      .spyOn(document.head, 'appendChild')
      .mockImplementation(<T extends Node>(node: T): T => {
        const result = originalAppendChild(node);
        if (
          node instanceof HTMLScriptElement &&
          node.src === 'https://js.useklump.com/klump.js'
        ) {
          window.Klump = mockKlumpConstructor as never;
          node.dispatchEvent(new Event('load'));
        }
        return result;
      });

    try {
      render(<BnplLauncher />);

      await waitFor(() => {
        expect(mockKlumpConstructor).toHaveBeenCalled();
      });
      expect(appendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          src: 'https://js.useklump.com/klump.js',
        })
      );
    } finally {
      appendSpy.mockRestore();
    }
  });

  it('records Klump callback transaction ids before redirecting to success', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
        klump_callback: '1',
        transaction_id: 'klump-txn-123',
      })
    );

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/payments/klump/record', {
        merchant_reference: 'BAC-ABCD12345678',
        klump_transaction_id: 'klump-txn-123',
        tracking_token: 'tok-123',
      });
    });

    expect(mockPush).toHaveBeenCalledWith(
      '/order-success?orderId=order-1&reference=BAC-ABCD12345678&type=klump&trackingToken=tok-123'
    );
  });

  it.each([
    { paymentStatus: 'paid', captures: true },
    { paymentStatus: 'pending', captures: false },
  ])(
    'counts the Klump conversion only when the order is server-confirmed paid ($paymentStatus)',
    async ({ paymentStatus, captures }) => {
      mockSearchParams.mockReturnValue(
        new URLSearchParams({
          orderId: 'order-1',
          gateway: 'klump',
          merchant_slug: 'test-store',
          reference: 'BAC-ABCD12345678',
          trackingToken: 'tok-123',
          klump_callback: '1',
          transaction_id: 'klump-txn-123',
        })
      );
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: 'order-1',
            payment_status: paymentStatus,
          }),
        })
      );

      render(<BnplLauncher />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(
          '/order-success?orderId=order-1&reference=BAC-ABCD12345678&type=klump&trackingToken=tok-123'
        );
      });
      const completedCalls =
        mockCaptureCheckoutFunnelEventOnce.mock.calls.filter(
          ([event]) => event === 'payment_completed'
        );
      expect(completedCalls.length).toBe(captures ? 1 : 0);
    }
  );

  it('passes the verified total and currency into the Klump conversion', async () => {
    mockSearchParams.mockReturnValue(
      new URLSearchParams({
        orderId: 'order-1',
        gateway: 'klump',
        merchant_slug: 'test-store',
        reference: 'BAC-ABCD12345678',
        trackingToken: 'tok-123',
        klump_callback: '1',
        transaction_id: 'klump-txn-123',
      })
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'order-1',
          payment_status: 'paid',
          total: 20000,
          currency: 'NGN',
        }),
      })
    );

    render(<BnplLauncher />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        '/order-success?orderId=order-1&reference=BAC-ABCD12345678&type=klump&trackingToken=tok-123'
      );
    });
    expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
      'payment_completed',
      'order-1',
      expect.objectContaining({
        payment_method: 'klump',
        payment_status: 'paid',
        reference: 'BAC-ABCD12345678',
        total: 20000,
        currency: 'NGN',
      })
    );
  });

  it('shows an error state and does not redirect when order fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Tracking token or email is required',
      })
    );

    const { findByRole, findByText } = render(<BnplLauncher />);

    expect(
      await findByRole('heading', { name: 'Something went wrong' })
    ).toBeInTheDocument();
    expect(
      await findByText('Failed to fetch order details (Status: 400)')
    ).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  describe('Credit Direct popup return verification', () => {
    function seedPopupMarker(
      orderId: string,
      transactionId: string,
      source?: 'popup' | 'sdk_success'
    ) {
      window.sessionStorage.setItem(
        `${CREDIT_DIRECT_POPUP_MARKER_PREFIX}${orderId}`,
        JSON.stringify({
          transactionId,
          storedAt: '2026-07-06T12:29:45.000Z',
          ...(source && { source }),
        })
      );
    }

    function stubOrderStatusFetch(paymentStatus: string | null) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: 'order-1',
            payment_status: paymentStatus,
            total: 1000,
            items: [
              {
                product_id: 'product-1',
                name: 'Capsule',
                price: 1000,
                quantity: 1,
              },
            ],
          }),
        })
      );
    }

    function seedCheckoutRecoveryState() {
      window.sessionStorage.setItem(
        CHECKOUT_PENDING_ORDER_STORAGE_KEY,
        JSON.stringify({ orderId: 'order-1' })
      );
      window.sessionStorage.setItem(
        'checkout-form',
        JSON.stringify({ customerEmail: 'customer@example.com' })
      );
      window.localStorage.setItem(
        CHECKOUT_IDEMPOTENCY_STORAGE_KEY,
        JSON.stringify({ key: 'checkout-key' })
      );
    }

    it('verifies the order instead of relaunching checkout when a popup marker exists', async () => {
      seedPopupMarker('order-1', 'txn-123');
      seedCheckoutRecoveryState();
      stubOrderStatusFetch('bnpl_approved');

      render(<BnplLauncher />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(
          '/order-success?orderId=order-1&reference=txn-123&type=credit_direct&trackingToken=tok-123'
        );
      });
      expect(mockOpenCreditDirectCheckout).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith(
        '/api/storefront/orders/order-1?merchant_slug=test-store&token=tok-123',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      await waitFor(() => {
        expect(readCreditDirectPopupMarker('order-1')).toBeNull();
        expect(
          window.sessionStorage.getItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY)
        ).toBeNull();
        expect(window.sessionStorage.getItem('checkout-form')).toBeNull();
        expect(
          window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY)
        ).toBeNull();
      });
      expect(mockClearCart).toHaveBeenCalledOnce();
    });

    it('shows the confirming state while the payment is still pending', async () => {
      seedPopupMarker('order-1', 'txn-123');
      seedCheckoutRecoveryState();
      stubOrderStatusFetch('bnpl_pending');

      render(<BnplLauncher />);

      expect(
        await screen.findByRole('heading', { name: 'Confirming your payment' })
      ).toBeInTheDocument();
      expect(mockOpenCreditDirectCheckout).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockClearCart).not.toHaveBeenCalled();
      expect(readCreditDirectPopupMarker('order-1')).not.toBeNull();
      expect(
        window.sessionStorage.getItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY)
      ).not.toBeNull();
      expect(window.sessionStorage.getItem('checkout-form')).not.toBeNull();
      expect(
        window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY)
      ).not.toBeNull();
    });

    it('honors an SDK completion handoff when session storage is unavailable', async () => {
      mockSearchParams.mockReturnValue(
        new URLSearchParams({
          orderId: 'order-1',
          gateway: 'credit_direct',
          merchant_slug: 'test-store',
          creditDirectCompletion: 'txn-url-fallback',
          trackingToken: 'tok-123',
        })
      );
      stubOrderStatusFetch('bnpl_pending');
      const getItemSpy = vi
        .spyOn(Storage.prototype, 'getItem')
        .mockImplementation(() => {
          throw new Error('storage unavailable');
        });
      const setItemSpy = vi
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => {
          throw new Error('storage unavailable');
        });

      try {
        render(<BnplLauncher />);

        expect(
          await screen.findByRole('heading', {
            name: 'Confirming your payment',
          })
        ).toBeInTheDocument();
        expect(mockOpenCreditDirectCheckout).not.toHaveBeenCalled();
        expect(
          screen.queryByRole('button', { name: 'Start a new payment attempt' })
        ).not.toBeInTheDocument();
      } finally {
        getItemSpy.mockRestore();
        setItemSpy.mockRestore();
      }
    });

    it('prefers an SDK completion handoff over a stale popup marker', async () => {
      seedPopupMarker('order-1', 'txn-stale-popup');
      mockSearchParams.mockReturnValue(
        new URLSearchParams({
          orderId: 'order-1',
          gateway: 'credit_direct',
          merchant_slug: 'test-store',
          creditDirectCompletion: 'txn-sdk-success',
          trackingToken: 'tok-123',
        })
      );
      stubOrderStatusFetch('bnpl_approved');

      render(<BnplLauncher />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(
          '/order-success?orderId=order-1&reference=txn-sdk-success&type=credit_direct&trackingToken=tok-123'
        );
      });
      expect(mockOpenCreditDirectCheckout).not.toHaveBeenCalled();
    });

    it('passes the verified total and currency into the Credit Direct conversion', async () => {
      mockSearchParams.mockReturnValue(
        new URLSearchParams({
          orderId: 'order-1',
          gateway: 'credit_direct',
          merchant_slug: 'test-store',
          creditDirectCompletion: 'txn-sdk-success',
          trackingToken: 'tok-123',
        })
      );
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: 'order-1',
            payment_status: 'bnpl_approved',
            total: 42000,
            currency: 'NGN',
          }),
        })
      );

      render(<BnplLauncher />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(
          '/order-success?orderId=order-1&reference=txn-sdk-success&type=credit_direct&trackingToken=tok-123'
        );
      });
      // The first capture must carry revenue: the once-guard suppresses
      // the richer order-success lookup that follows.
      expect(mockCaptureCheckoutFunnelEventOnce).toHaveBeenCalledWith(
        'payment_completed',
        'order-1',
        expect.objectContaining({
          payment_method: 'credit_direct',
          payment_status: 'paid',
          reference: 'txn-sdk-success',
          total: 42000,
          currency: 'NGN',
        })
      );
    });

    it('shows the cancelled state without clearing checkout recovery', async () => {
      seedPopupMarker('order-1', 'txn-123');
      seedCheckoutRecoveryState();
      stubOrderStatusFetch('cancelled');

      render(<BnplLauncher />);

      expect(
        await screen.findByRole('heading', { name: 'Order cancelled' })
      ).toBeInTheDocument();
      expect(mockOpenCreditDirectCheckout).not.toHaveBeenCalled();
      expect(mockClearCart).not.toHaveBeenCalled();
      expect(readCreditDirectPopupMarker('order-1')).not.toBeNull();
      expect(
        window.sessionStorage.getItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY)
      ).not.toBeNull();
      expect(window.sessionStorage.getItem('checkout-form')).not.toBeNull();
      expect(
        window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY)
      ).not.toBeNull();
    });

    it('writes a popup marker when the Credit Direct SDK opens its popup', async () => {
      let capturedOnPopup:
        | ((reference: {
            checkoutTransactionId: string | null;
            sessionId: string;
          }) => Promise<void>)
        | undefined;
      mockOpenCreditDirectCheckout.mockImplementation(({ onPopup }) => {
        capturedOnPopup = onPopup;
        return Promise.resolve();
      });

      render(<BnplLauncher />);

      await waitFor(() => {
        expect(mockOpenCreditDirectCheckout).toHaveBeenCalled();
      });
      await capturedOnPopup?.({
        checkoutTransactionId: 'txn-999',
        sessionId: 'signed-session-1',
      });

      expect(readCreditDirectPopupMarker('order-1')?.transactionId).toBe(
        'txn-999'
      );
    });

    it('posts a provider-opened signal when the Credit Direct popup opens', async () => {
      const postMessage = vi.fn();
      (window as TestReactNativeWebViewWindow).ReactNativeWebView = {
        postMessage,
      };
      let capturedOnPopup:
        | ((reference: {
            checkoutTransactionId: string | null;
            sessionId: string;
          }) => Promise<void>)
        | undefined;
      mockOpenCreditDirectCheckout.mockImplementation(({ onPopup }) => {
        capturedOnPopup = onPopup;
        return Promise.resolve();
      });

      render(<BnplLauncher />);

      await waitFor(() => {
        expect(mockOpenCreditDirectCheckout).toHaveBeenCalled();
      });
      await capturedOnPopup?.({
        checkoutTransactionId: 'txn-999',
        sessionId: 'signed-session-1',
      });

      expect(postMessage).toHaveBeenCalledWith(
        JSON.stringify({
          gateway: 'credit_direct',
          orderId: 'order-1',
          type: 'bnpl_provider_opened',
        })
      );
    });

    it('keeps verifying when recording an in-page success callback fails', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (input) => {
          if (String(input) === '/api/orders/credit-direct/client-completion') {
            return {
              ok: false,
              status: 500,
              statusText: 'Server Error',
              text: async () => 'write failed',
            } as Response;
          }

          return {
            ok: true,
            json: async () => ({
              id: 'order-1',
              tracking_token: 'track-order-token',
              payment_status: 'bnpl_pending',
              total: 1000,
              customer_email: 'customer@example.com',
              customer_phone: '08012345678',
              customer_name: 'John Doe',
              items: [
                {
                  product_id: 'product-1',
                  name: 'Capsule',
                  price: 1000,
                  quantity: 1,
                },
              ],
            }),
          } as Response;
        })
      );
      try {
        mockOpenCreditDirectCheckout.mockImplementation(
          async ({ onPopup, onSuccess }) => {
            const reference = {
              checkoutTransactionId: 'txn-999',
              sessionId: 'signed-session-1',
            };
            await onPopup(reference);
            onSuccess(reference);
          }
        );

        render(<BnplLauncher />);

        expect(
          await screen.findByRole('heading', {
            name: 'Confirming your payment',
          })
        ).toBeInTheDocument();
        expect(readCreditDirectPopupMarker('order-1')?.transactionId).toBe(
          'txn-999'
        );
        expect(mockPush).not.toHaveBeenCalled();
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it('relaunches checkout after starting a new attempt on a verification timeout', async () => {
      vi.useFakeTimers();
      try {
        seedPopupMarker('order-1', 'txn-123');
        seedCheckoutRecoveryState();
        stubOrderStatusFetch('bnpl_pending');

        render(<BnplLauncher />);
        await act(async () => {});
        await act(async () => {
          await vi.advanceTimersByTimeAsync(151_000);
        });
      } finally {
        vi.useRealTimers();
      }

      expect(mockClearCart).not.toHaveBeenCalled();
      expect(readCreditDirectPopupMarker('order-1')).not.toBeNull();
      expect(
        window.sessionStorage.getItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY)
      ).not.toBeNull();
      expect(window.sessionStorage.getItem('checkout-form')).not.toBeNull();
      expect(
        window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY)
      ).not.toBeNull();

      fireEvent.click(
        screen.getByRole('button', { name: 'Start a new payment attempt' })
      );

      await waitFor(() => {
        expect(mockOpenCreditDirectCheckout).toHaveBeenCalled();
      });
      expect(readCreditDirectPopupMarker('order-1')).toBeNull();
    });

    it('does not offer a new attempt after SDK success times out', async () => {
      vi.useFakeTimers();
      try {
        seedPopupMarker('order-1', 'txn-123', 'sdk_success');
        stubOrderStatusFetch('bnpl_pending');

        render(<BnplLauncher />);
        await act(async () => {});
        await act(async () => {
          await vi.advanceTimersByTimeAsync(151_000);
        });
      } finally {
        vi.useRealTimers();
      }

      expect(
        screen.queryByRole('button', { name: 'Start a new payment attempt' })
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Keep checking' })).toBeEnabled();
      expect(readCreditDirectPopupMarker('order-1')?.source).toBe('sdk_success');
      expect(mockOpenCreditDirectCheckout).not.toHaveBeenCalled();
    });

    it('includes the lookup email on the verified success redirect when no tracking token exists', async () => {
      mockSearchParams.mockReturnValue(
        new URLSearchParams({
          orderId: 'order-1',
          gateway: 'credit_direct',
          merchant_slug: 'test-store',
          email: 'customer@example.com',
        })
      );
      seedPopupMarker('order-1', 'txn-123');
      stubOrderStatusFetch('bnpl_approved');

      render(<BnplLauncher />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(
          '/order-success?orderId=order-1&reference=txn-123&type=credit_direct&email=customer%40example.com'
        );
      });
    });

    it('returns to the storefront home from the verification view on slug-prefixed launchers', async () => {
      vi.useFakeTimers();
      try {
        window.history.replaceState({}, '', '/test-store/checkout/bnpl');
        seedPopupMarker('order-1', 'txn-123');
        stubOrderStatusFetch('bnpl_pending');

        render(<BnplLauncher />);
        await act(async () => {});
        await act(async () => {
          await vi.advanceTimersByTimeAsync(151_000);
        });
      } finally {
        vi.useRealTimers();
      }

      fireEvent.click(screen.getByRole('button', { name: 'Return to Home' }));

      expect(mockPush).toHaveBeenCalledWith('/test-store');
    });

    it('keeps the storefront slug prefix on the verified success redirect', async () => {
      window.history.replaceState({}, '', '/test-store/checkout/bnpl');
      seedPopupMarker('order-1', 'txn-123');
      stubOrderStatusFetch('bnpl_approved');

      render(<BnplLauncher />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(
          '/test-store/order-success?orderId=order-1&reference=txn-123&type=credit_direct&trackingToken=tok-123'
        );
      });
    });

    // Regression test for the marker-adoption/error race: onPopup stores the
    // popup marker, then a bfcache restore adopts it into React state before
    // onError fires. The error/retry view must replace payment verification.
    it('clears a stale popup marker when the SDK reports an error', async () => {
      let onPopup:
        | ((reference: {
            checkoutTransactionId: string | null;
            sessionId: string;
          }) => Promise<void>)
        | undefined;
      let onError: ((error: string) => void) | undefined;
      mockOpenCreditDirectCheckout.mockImplementation((options) => {
        onPopup = options.onPopup;
        onError = options.onError;
        return Promise.resolve();
      });

      render(<BnplLauncher />);

      await waitFor(() => {
        expect(mockOpenCreditDirectCheckout).toHaveBeenCalledOnce();
      });
      await act(async () => {
        await onPopup?.({
          checkoutTransactionId: 'txn-999',
          sessionId: 'signed-session-1',
        });
      });
      const pageShowEvent = new Event('pageshow');
      Object.defineProperty(pageShowEvent, 'persisted', { value: true });
      act(() => window.dispatchEvent(pageShowEvent));

      expect(
        await screen.findByRole('heading', {
          name: 'Confirming your payment',
        })
      ).toBeInTheDocument();

      act(() => onError?.('SDK failed to open'));

      expect(
        await screen.findByRole(
          'heading',
          { name: 'Something went wrong' },
          { timeout: 5000 }
        )
      ).toBeInTheDocument();
      expect(readCreditDirectPopupMarker('order-1')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

      expect(readCreditDirectPopupMarker('order-1')).toBeNull();
    });

    it('launches a new order after the previous launcher URL errors', async () => {
      mockOpenCreditDirectCheckout.mockImplementationOnce(({ onError }) => {
        onError('SDK failed to open');
        return Promise.resolve();
      });
      mockOpenCreditDirectCheckout.mockResolvedValueOnce(undefined);

      const { rerender } = render(<BnplLauncher />);

      expect(
        await screen.findByRole('heading', { name: 'Something went wrong' })
      ).toBeInTheDocument();

      mockSearchParams.mockReturnValue(
        new URLSearchParams({
          orderId: 'order-2',
          gateway: 'credit_direct',
          merchant_slug: 'test-store',
          trackingToken: 'tok-456',
        })
      );
      rerender(<BnplLauncher />);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          '/api/storefront/orders/order-2?merchant_slug=test-store&token=tok-456'
        );
      });
      expect(mockOpenCreditDirectCheckout).toHaveBeenCalledTimes(2);
    });
  });
});
