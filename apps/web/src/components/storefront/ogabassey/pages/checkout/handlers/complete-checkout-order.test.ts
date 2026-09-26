import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureCheckoutPaymentCompleted } from '../capture-checkout-payment-completed';
import { clearCheckoutIdempotencyKey } from '../checkout-idempotency';
import { completeCheckoutOrder } from './complete-checkout-order';

vi.mock('../capture-checkout-payment-completed', () => ({
  captureCheckoutPaymentCompleted: vi.fn(),
}));
vi.mock('../checkout-idempotency', () => ({
  clearCheckoutIdempotencyKey: vi.fn(async () => undefined),
}));

function setup() {
  return {
    order: { id: 'order-1', tracking_token: 'token & value', total: 5000 },
    checkoutFingerprint: 'this-checkout',
    clearPendingCheckoutOrder: vi.fn(),
    clearCheckoutSession: vi.fn(),
    clearCart: vi.fn(),
    pushSuccessRoute: vi.fn(),
  };
}

describe('completeCheckoutOrder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    'invoice',
    'standard',
  ] as const)('hands off %s with the tracking identity and defers cart cleanup', async (kind) => {
    const options = setup();
    await completeCheckoutOrder({ ...options, completion: { kind } });

    const query = new URL(
      options.pushSuccessRoute.mock.calls[0][0],
      'https://store.example'
    ).searchParams;
    expect(query.get('type')).toBe(kind);
    expect(query.get('orderId')).toBe('order-1');
    expect(query.get('trackingToken')).toBe('token & value');
    expect(options.clearPendingCheckoutOrder).toHaveBeenCalledOnce();
    expect(clearCheckoutIdempotencyKey).toHaveBeenCalledWith('this-checkout');
    expect(options.clearCheckoutSession).toHaveBeenCalledOnce();
    expect(captureCheckoutPaymentCompleted).not.toHaveBeenCalled();
    expect(options.clearCart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(499);
    expect(options.clearCart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(options.clearCart).toHaveBeenCalledOnce();
  });

  it('preserves the Pay for Me payer name without fabricating a paid event', async () => {
    const options = setup();
    await completeCheckoutOrder({
      ...options,
      completion: { kind: 'payforme', payerName: 'Ada & Grace' },
    });
    const query = new URL(
      options.pushSuccessRoute.mock.calls[0][0],
      'https://store.example'
    ).searchParams;
    expect(query.get('payerName')).toBe('Ada & Grace');
    expect(query.get('type')).toBe('payforme');
    expect(captureCheckoutPaymentCompleted).not.toHaveBeenCalled();
  });

  it('records zero-due completion only using a server-paid order and its method/total', async () => {
    const options = setup();
    await completeCheckoutOrder({
      ...options,
      order: {
        ...options.order,
        payment_status: 'paid',
        payment_method: 'wallet',
      },
      completion: {
        kind: 'zero_due',
        paymentMethod: 'paystack',
        currency: 'NGN',
        orderNumber: 'ORDER-1',
        total: 9000,
      },
    });
    expect(captureCheckoutPaymentCompleted).toHaveBeenCalledExactlyOnceWith({
      currency: 'NGN',
      orderId: 'order-1',
      orderNumber: 'ORDER-1',
      paymentMethod: 'wallet',
      total: 5000,
    });
    const query = new URL(
      options.pushSuccessRoute.mock.calls[0][0],
      'https://store.example'
    ).searchParams;
    expect(query.get('wallet')).toBe('true');
    expect(query.get('type')).toBeNull();
  });

  it('does not count an unpaid zero-due invoice as a payment', async () => {
    const options = setup();
    await completeCheckoutOrder({
      ...options,
      order: { ...options.order, payment_status: 'unpaid' },
      completion: {
        kind: 'zero_due',
        paymentMethod: 'invoice',
        currency: 'NGN',
        orderNumber: 'ORDER-1',
        total: 0,
      },
    });
    expect(captureCheckoutPaymentCompleted).not.toHaveBeenCalled();
    expect(options.pushSuccessRoute).toHaveBeenCalledOnce();
  });

  it('waits for recovery cleanup before routing and omits a missing token', async () => {
    const options = setup();
    let finishCleanup = () => {};
    vi.mocked(clearCheckoutIdempotencyKey).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCleanup = resolve;
        })
    );
    const completion = completeCheckoutOrder({
      ...options,
      order: { id: 'order-1' },
      completion: { kind: 'invoice' },
    });
    expect(options.pushSuccessRoute).not.toHaveBeenCalled();
    expect(options.clearCheckoutSession).not.toHaveBeenCalled();
    finishCleanup();
    await completion;
    expect(options.pushSuccessRoute).toHaveBeenCalledWith(
      '/order-success?type=invoice&orderId=order-1'
    );
  });
});
