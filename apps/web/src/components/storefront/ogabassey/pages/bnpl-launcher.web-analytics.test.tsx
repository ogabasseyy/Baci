import { render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetKlumpSdkLoadForTests } from '@/lib/klump-sdk';
import { BnplLauncher } from './bnpl-launcher';

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
  usePathname: vi.fn(() => '/checkout/bnpl'),
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

});
