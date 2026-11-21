import type { useRouter } from 'next/navigation';
import { vi } from 'vitest';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import { useCheckoutSuccessVerification as useVerification } from './use-checkout-success-verification';
import {
  hasMatchingPendingRedvaultOrder,
  verifyCheckoutPayment,
} from './verify-checkout-payment';

vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: vi.fn(),
}));

vi.mock('./verify-checkout-payment', () => ({
  hasMatchingPendingRedvaultOrder: vi.fn(),
  verifyCheckoutPayment: vi.fn(),
}));

export const mockVerify = vi.mocked(verifyCheckoutPayment);
export const mockHasPendingRedvault = vi.mocked(
  hasMatchingPendingRedvaultOrder
);
export const mockCapture = vi.mocked(captureCheckoutFunnelEventOnce);

export function setup(overrides = {}) {
  const push = vi.fn();
  const clearCart = vi.fn();
  const props = {
    merchantSlug: 'test-store',
    orderId: 'order-1',
    paymentMethodParam: 'paystack',
    reference: 'ref-1',
    trackingToken: 'track-1',
    clearCart,
    router: { push } as unknown as ReturnType<typeof useRouter>,
    basePath: '/test-store',
    isReady: true,
    ...overrides,
  };
  return { push, clearCart, props };
}

export const useCheckoutSuccessVerification = useVerification;
