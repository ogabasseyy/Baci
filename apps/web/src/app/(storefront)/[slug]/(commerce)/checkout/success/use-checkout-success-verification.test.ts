// @vitest-environment jsdom

import { CHECKOUT_FUNNEL_EVENTS } from '@baci/shared/contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKOUT_PENDING_ORDER_STORAGE_KEY } from '@/components/storefront/ogabassey/pages/checkout/pending-checkout-order';
import {
  mockCapture,
  mockHasPendingRedvault,
  mockVerify,
  setup,
  useCheckoutSuccessVerification,
} from './use-checkout-success-verification.test-support';

describe('useCheckoutSuccessVerification', () => {
  beforeEach(() => {
    mockHasPendingRedvault.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('runs verification on mount with the derived identity', async () => {
    mockVerify.mockResolvedValue(undefined);
    const { props } = setup();

    renderHook(() => useCheckoutSuccessVerification(props));

    await waitFor(() => expect(mockVerify).toHaveBeenCalledTimes(1));
    expect(mockVerify).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantSlug: 'test-store',
        orderId: 'order-1',
        reference: 'ref-1',
        trackingToken: 'track-1',
        pendingRedvaultOrder: false,
      }),
      expect.objectContaining({
        clearCart: expect.any(Function),
        setStatus: expect.any(Function),
      })
    );
    act(() => mockVerify.mock.calls[0][1].clearCart());
    expect(props.clearCart).toHaveBeenCalledOnce();
    expect(mockHasPendingRedvault).toHaveBeenCalledWith('order-1');
  });

  describe('bugfix: reloaded link verified once with the reference missing', () => {
    it('waits for the stashed order details before verifying', async () => {
      mockVerify.mockResolvedValue(undefined);
      const { props } = setup({ isReady: false, reference: null });

      const { rerender } = renderHook(
        (hookProps) => useCheckoutSuccessVerification(hookProps),
        { initialProps: props }
      );
      await act(async () => {});
      expect(mockVerify).not.toHaveBeenCalled();
      expect(mockCapture).not.toHaveBeenCalled();

      rerender({ ...props, isReady: true, reference: 'ref-1' });

      await waitFor(() => expect(mockVerify).toHaveBeenCalledTimes(1));
      expect(mockVerify).toHaveBeenCalledWith(
        expect.objectContaining({ reference: 'ref-1' }),
        expect.anything()
      );
    });
  });

  it('exposes the verified order and clears the pending-order marker', async () => {
    mockVerify.mockImplementation(async (_params, handlers) => {
      handlers.setStatus('success');
      handlers.setOrderNumber('BAC-1');
      handlers.setPaymentMethod('paystack');
    });
    window.sessionStorage.setItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY, '{}');
    const { props } = setup();

    const { result } = renderHook(() => useCheckoutSuccessVerification(props));

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.orderNumber).toBe('BAC-1');
    expect(result.current.paymentMethod).toBe('paystack');
    expect(
      window.sessionStorage.getItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY)
    ).toBeNull();
  });

  it('bugfix: keeps the success state when blocked storage throws during cleanup', async () => {
    mockVerify.mockImplementation(async (_params, handlers) => {
      handlers.setStatus('success');
    });
    const removeItem = vi
      .spyOn(Storage.prototype, 'removeItem')
      .mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
    try {
      const { props } = setup();

      const { result } = renderHook(() =>
        useCheckoutSuccessVerification(props)
      );

      await waitFor(() => expect(result.current.status).toBe('success'));
      expect(removeItem).toHaveBeenCalled();
    } finally {
      removeItem.mockRestore();
    }
  });

  it('redirects to checkout 4s after a scheduled failure', async () => {
    vi.useFakeTimers();
    mockVerify.mockResolvedValue(undefined);
    const { props, push } = setup();

    renderHook(() => useCheckoutSuccessVerification(props));

    await act(async () => {});
    expect(mockVerify).toHaveBeenCalledTimes(1);
    await act(async () => {
      mockVerify.mock.calls[0][1].scheduleFailedRedirect();
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(push).toHaveBeenCalledWith('/test-store/checkout');
  });

  it('attributes completions and failures per attempt', async () => {
    mockVerify.mockResolvedValue(undefined);
    const { props } = setup();

    renderHook(() => useCheckoutSuccessVerification(props));

    await waitFor(() => expect(mockVerify).toHaveBeenCalledTimes(1));
    const handlers = mockVerify.mock.calls[0][1];

    act(() => {
      handlers.capturePaymentCompleted({
        orderId: 'order-1',
        orderNumber: 'BAC-1',
        paymentMethod: 'paystack',
        reference: 'ref-1',
        total: 21500,
        currency: 'NGN',
      });
      handlers.capturePaymentFailed({
        orderId: 'order-1',
        reference: 'ref-1',
        reason: 'gateway_timeout',
      });
    });

    expect(mockCapture).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
      'order-1',
      expect.objectContaining({
        payment_method: 'paystack',
        payment_status: 'paid',
        total: 21500,
      })
    );
    expect(mockCapture).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.paymentFailed,
      'order-1:ref-1',
      expect.objectContaining({ reason: 'gateway_timeout' })
    );
  });
});
