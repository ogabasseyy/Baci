import { describe, expect, it, vi } from 'vitest';
import { openCheckoutCredpal } from './open-checkout-credpal';

function options() {
  return {
    key: 'credpal-key',
    amount: 4200,
    product: 'Phone',
    customerEmail: 'customer@example.com',
    customerName: 'Ada Customer',
    customerPhone: '08000000000',
    order: { id: 'order-1', tracking_token: 'token-1' },
    checkoutFingerprint: 'fingerprint',
    onPaymentStarted: vi.fn(),
    paymentStarted: vi.fn(() => true),
    onPaymentCompleted: vi.fn(),
    onPaymentFailed: vi.fn(),
    clearPendingCheckoutOrder: vi.fn(),
    clearCheckoutIdempotencyKey: vi.fn(async () => undefined),
    clearCheckoutSession: vi.fn(),
    clearCart: vi.fn(),
    navigate: vi.fn(),
    onUnavailable: vi.fn(),
    onError: vi.fn(),
    releaseSubmitLock: vi.fn(),
  };
}

describe('openCheckoutCredpal', () => {
  it('does not launch when the provider key is unavailable', async () => {
    const input = options();
    const openCheckout = vi.fn();
    await openCheckoutCredpal({
      ...input,
      key: undefined,
      openCheckout: openCheckout as never,
    });
    expect(openCheckout).not.toHaveBeenCalled();
    expect(input.onUnavailable).toHaveBeenCalledOnce();
    expect(input.releaseSubmitLock).toHaveBeenCalledOnce();
  });

  it('records a paid callback and routes accepted results with their reference', async () => {
    const input = options();
    const openCheckout = vi.fn(async (callbacks) => {
      await callbacks.onSuccess({ status: 'success', order_no: 'credpal-ref' });
    });
    await openCheckoutCredpal({
      ...input,
      openCheckout: openCheckout as never,
    });
    expect(input.onPaymentCompleted).toHaveBeenCalledWith('credpal-ref');
    expect(input.navigate).toHaveBeenCalledWith(
      expect.stringContaining('trackingToken=token-1')
    );
  });

  it('only reports an error after the widget has opened', async () => {
    const input = options();
    input.paymentStarted.mockReturnValue(false);
    const openCheckout = vi.fn(async (callbacks) => {
      callbacks.onError(new Error('SDK failed'));
    });
    await openCheckoutCredpal({
      ...input,
      openCheckout: openCheckout as never,
    });
    expect(input.onPaymentFailed).not.toHaveBeenCalled();
    expect(input.onError).toHaveBeenCalledWith(expect.any(Error));
  });
});
