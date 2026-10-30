import { vi } from 'vitest';
import { resetKlumpSdkLoadForTests } from '@/lib/klump-sdk';

const mocks = vi.hoisted(() => {
  const mockPush = vi.fn();
  return {
    mockClearCart: vi.fn(),
    mockPush,
    mockRouter: { push: mockPush },
    mockSearchParams: vi.fn(),
    mockOpenCreditDirectCheckout: vi.fn(),
    mockOpenCredPalCheckout: vi.fn(),
    mockApiPost: vi.fn(),
    mockKlumpConstructor: vi.fn(),
    mockCaptureCheckoutFunnelEventOnce: vi.fn(),
    mockCaptureClientEvent: vi.fn(),
  };
});

export const {
  mockClearCart,
  mockPush,
  mockRouter,
  mockSearchParams,
  mockOpenCreditDirectCheckout,
  mockOpenCredPalCheckout,
  mockApiPost,
  mockKlumpConstructor,
  mockCaptureCheckoutFunnelEventOnce,
  mockCaptureClientEvent,
} = mocks;

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => mocks.mockRouter),
  useSearchParams: vi.fn(() => mocks.mockSearchParams()),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: vi.fn(() => ({
    merchant: { slug: 'test-store' },
    loading: false,
  })),
}));

vi.mock('@/hooks/cart', () => ({
  useCartSafe: () => ({ clearCart: mocks.mockClearCart }),
}));

vi.mock('@/lib/credit-direct-client', () => ({
  openCreditDirectCheckout: (...args: unknown[]) =>
    mocks.mockOpenCreditDirectCheckout(...args),
}));

vi.mock('@/lib/credpal', () => ({
  openCredPalCheckout: (...args: unknown[]) =>
    mocks.mockOpenCredPalCheckout(...args),
  getCredPalKey: vi.fn(() => 'credpal_test_key'),
}));

vi.mock('@/lib/api-client', () => ({
  apiPost: (...args: unknown[]) => mocks.mockApiPost(...args),
  fetchWithCsrf: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
}));

vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: (...args: unknown[]) =>
    mocks.mockCaptureCheckoutFunnelEventOnce(...args),
}));

vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: (...args: unknown[]) =>
    mocks.mockCaptureClientEvent(...args),
}));

interface TestReactNativeWebViewWindow extends Window {
  ReactNativeWebView?: {
    postMessage: (message: string) => void;
  };
}

export function resetBnplLauncherTestState(): void {
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
}
