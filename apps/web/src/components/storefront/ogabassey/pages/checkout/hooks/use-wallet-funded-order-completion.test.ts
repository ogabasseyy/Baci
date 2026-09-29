import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const captureMock = vi.hoisted(() => vi.fn());
const clearKeyMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('../capture-checkout-payment-completed', () => ({
  captureCheckoutPaymentCompleted: captureMock,
}));
vi.mock('../checkout-idempotency', () => ({
  clearCheckoutIdempotencyKey: clearKeyMock,
}));

import { useWalletFundedOrderCompletion } from './use-wallet-funded-order-completion';

describe('useWalletFundedOrderCompletion', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('records the confirmed order, clears its recovery state, routes, then clears the cart after 500ms', () => {
    vi.useFakeTimers();
    const events: string[] = [];
    captureMock.mockImplementation(() => events.push('capture'));
    clearKeyMock.mockImplementation(() => events.push('idempotency'));
    pushMock.mockImplementation(() => events.push('route'));
    const clearPending = vi.fn(() => events.push('pending'));
    const clearSession = vi.fn(() => events.push('session'));
    const clearCart = vi.fn(() => events.push('cart'));
    const { result, unmount } = renderHook(() =>
      useWalletFundedOrderCompletion({
        clearCart,
        clearCheckoutSession: clearSession,
        clearPendingCheckoutOrder: clearPending,
        getHref: (path) => `/shop${path}`,
        paymentMethod: 'bank_transfer',
      })
    );

    act(() => {
      result.current({
        checkoutFingerprint: 'fingerprint-1',
        currency: 'NGN',
        intentId: 'intent-1',
        orderId: 'order /1',
        orderNumber: 'ORD-1',
        total: 5750,
        trackingToken: 'track /?&',
      });
    });

    expect(captureMock).toHaveBeenCalledWith({
      currency: 'NGN',
      orderId: 'order /1',
      orderNumber: 'ORD-1',
      paymentMethod: 'bank_transfer',
      reference: 'intent-1',
      total: 5750,
    });
    expect(clearPending).toHaveBeenCalledOnce();
    expect(clearKeyMock).toHaveBeenCalledWith('fingerprint-1');
    expect(clearSession).toHaveBeenCalledOnce();
    expect(pushMock).toHaveBeenCalledWith(
      '/shop/order-success?orderId=order+%2F1&wallet=true&trackingToken=track+%2F%3F%26'
    );
    expect(events).toEqual([
      'capture',
      'pending',
      'idempotency',
      'session',
      'route',
    ]);
    unmount();
    expect(clearCart).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(499));
    expect(clearCart).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(clearCart).toHaveBeenCalledOnce();
  });

  it('omits absent order number and tracking token from analytics and the success URL', () => {
    const { result } = renderHook(() =>
      useWalletFundedOrderCompletion({
        clearCart: vi.fn(),
        clearCheckoutSession: vi.fn(),
        clearPendingCheckoutOrder: vi.fn(),
        getHref: (path) => path,
        paymentMethod: 'bank_transfer',
      })
    );

    act(() => {
      result.current({
        checkoutFingerprint: 'fingerprint-2',
        currency: 'NGN',
        intentId: 'intent-2',
        orderId: 'order-2',
        total: 5000,
      });
    });

    expect(captureMock).toHaveBeenCalledWith({
      currency: 'NGN',
      orderId: 'order-2',
      paymentMethod: 'bank_transfer',
      reference: 'intent-2',
      total: 5000,
    });
    expect(pushMock).toHaveBeenCalledWith(
      '/order-success?orderId=order-2&wallet=true'
    );
  });

  it('keeps the post-navigation cart clear scheduled when the checkout hook unmounts', () => {
    vi.useFakeTimers();
    const clearCart = vi.fn();
    const { result, unmount } = renderHook(() =>
      useWalletFundedOrderCompletion({
        clearCart,
        clearCheckoutSession: vi.fn(),
        clearPendingCheckoutOrder: vi.fn(),
        getHref: (path) => path,
        paymentMethod: 'bank_transfer',
      })
    );

    act(() => {
      result.current({
        checkoutFingerprint: 'fingerprint-3',
        currency: 'NGN',
        intentId: 'intent-3',
        orderId: 'order-3',
        total: 5000,
      });
    });
    unmount();

    act(() => vi.advanceTimersByTime(500));
    expect(clearCart).toHaveBeenCalledOnce();
  });
});
