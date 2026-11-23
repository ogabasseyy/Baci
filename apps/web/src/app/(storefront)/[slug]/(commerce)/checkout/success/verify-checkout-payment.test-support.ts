import { vi } from 'vitest';

export function handlers() {
  return {
    capturePaymentCompleted: vi.fn(),
    capturePaymentFailed: vi.fn(),
    clearCart: vi.fn(),
    redirectToCheckout: vi.fn(),
    scheduleFailedRedirect: vi.fn(),
    setIsVerifying: vi.fn(),
    setOrderNumber: vi.fn(),
    setPaymentMethod: vi.fn(),
    setStatus: vi.fn(),
  };
}

export const params = {
  merchantSlug: 'ogabassey',
  orderId: 'order-id',
  paymentMethod: null,
  pendingRedvaultOrder: false,
  reference: null,
  trackingToken: null,
};
