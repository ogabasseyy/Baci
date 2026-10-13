import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';
import type { CreditDirectCheckoutOptions } from '@/lib/credit-direct-client';
import { captureCheckoutPaymentFailed } from '../capture-checkout-payment-failed';
import { captureCreditDirectClientCompletion } from '../credit-direct-client-completion';
import { writeCreditDirectPopupMarker } from '../credit-direct-popup-return';
import { persistCreditDirectPopupReference } from '../persist-credit-direct-popup-reference';
import { openCheckoutCreditDirect } from './open-checkout-credit-direct';

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('../capture-checkout-payment-failed', () => ({
  captureCheckoutPaymentFailed: vi.fn(),
}));
vi.mock('../credit-direct-client-completion', () => ({
  captureCreditDirectClientCompletion: vi.fn(() => ({
    source: 'sdk_success',
    transactionId: 'completed-ref',
    storedAt: '2026-09-25T00:00:00Z',
  })),
}));
vi.mock('../credit-direct-popup-return', () => ({
  writeCreditDirectPopupMarker: vi.fn(),
}));
vi.mock('../persist-credit-direct-popup-reference', () => ({
  persistCreditDirectPopupReference: vi.fn(async () => undefined),
}));

async function open() {
  const options = {
    merchantSlug: 'merchant',
    order: { id: 'order-1', tracking_token: 'token', total: 5000 },
    amount: 4200,
    total: 9000,
    currency: 'NGN',
    orderNumber: 'ORDER-1',
    customer: {
      email: 'shopper@example.test',
      phone: '08000000000',
      name: 'Ada',
    },
    items: buildCheckoutOrderItems([
      { id: 'product-1', name: 'Phone', price: 5000, quantity: 1 },
    ]),
    onPaymentStarted: vi.fn(),
    onIdle: vi.fn(),
    navigate: vi.fn(),
  };
  const openCheckout = vi.fn<
    (options: CreditDirectCheckoutOptions) => Promise<void>
  >(async () => undefined);
  await openCheckoutCreditDirect(options, openCheckout);
  return { options, callbacks: openCheckout.mock.calls[0][0] };
}

describe('openCheckoutCreditDirect', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves canonical item weights and a residual provider charge', async () => {
    const { callbacks, options } = await open();
    expect(callbacks).toMatchObject({
      orderId: 'order-1',
      trackingToken: 'token',
      amount: 4200,
      items: [{ id: 'product-1', name: 'Phone', price: 5000, quantity: 1 }],
    });
    expect(options.onPaymentStarted).not.toHaveBeenCalled();
  });

  it('unlocks close and setup failure without attributing a payment that never started', async () => {
    const { callbacks, options } = await open();
    callbacks.onClose();
    expect(options.onIdle).toHaveBeenCalledOnce();
    callbacks.onError('SDK unavailable');
    expect(options.onIdle).toHaveBeenCalledTimes(2);
    expect(captureCheckoutPaymentFailed).not.toHaveBeenCalled();
  });

  it('persists popup identity and attributes later failures to its reference and canonical total', async () => {
    const { callbacks, options } = await open();
    await callbacks.onPopup?.({
      checkoutTransactionId: 'popup-ref',
      sessionId: 'session-1',
    });
    expect(writeCreditDirectPopupMarker).toHaveBeenCalledWith(
      'order-1',
      'popup-ref'
    );
    expect(persistCreditDirectPopupReference).toHaveBeenCalledWith(
      options.order,
      'popup-ref'
    );
    expect(options.onPaymentStarted).toHaveBeenCalledWith('popup-ref');
    callbacks.onError('Provider rejected application');
    expect(captureCheckoutPaymentFailed).toHaveBeenCalledWith({
      currency: 'NGN',
      orderId: 'order-1',
      orderNumber: 'ORDER-1',
      paymentMethod: 'credit_direct',
      reason: 'credit_direct_error',
      reference: 'popup-ref',
      total: 5000,
    });
    expect(options.onIdle).toHaveBeenCalledOnce();
  });

  it('keeps a session-only popup marker without writing an absent transaction reference', async () => {
    const { callbacks, options } = await open();
    await callbacks.onPopup?.({
      checkoutTransactionId: null,
      sessionId: 'session-1',
    });
    expect(options.onPaymentStarted).toHaveBeenCalledWith('session-1');
    expect(writeCreditDirectPopupMarker).toHaveBeenCalledWith(
      'order-1',
      'session-1'
    );
    expect(persistCreditDirectPopupReference).not.toHaveBeenCalled();
  });

  it('retains local popup evidence if server reference persistence fails', async () => {
    vi.mocked(persistCreditDirectPopupReference).mockRejectedValueOnce(
      new Error('offline')
    );
    const { callbacks, options } = await open();
    await expect(
      callbacks.onPopup?.({
        checkoutTransactionId: 'popup-ref',
        sessionId: 'session-1',
      })
    ).resolves.toBeUndefined();
    expect(writeCreditDirectPopupMarker).toHaveBeenCalledWith(
      'order-1',
      'popup-ref'
    );
    expect(options.onIdle).not.toHaveBeenCalled();
    expect(captureCheckoutPaymentFailed).not.toHaveBeenCalled();
  });

  it('hands SDK completion to server verification with recovery identity intact', async () => {
    const { callbacks, options } = await open();
    callbacks.onSuccess({
      checkoutTransactionId: 'completed-ref',
      sessionId: 'session-1',
    });
    expect(captureCreditDirectClientCompletion).toHaveBeenCalledWith({
      orderId: 'order-1',
      checkoutTransactionId: 'completed-ref',
      sessionId: 'session-1',
      customerEmail: 'shopper@example.test',
      trackingToken: 'token',
    });
    const query = new URL(
      options.navigate.mock.calls[0][0],
      'https://store.example'
    ).searchParams;
    expect(query.get('gateway')).toBe('credit_direct');
    expect(query.get('trackingToken')).toBe('token');
    expect(query.get('creditDirectCompletion')).toBe('completed-ref');
    expect(options.onIdle).not.toHaveBeenCalled();
  });
});
