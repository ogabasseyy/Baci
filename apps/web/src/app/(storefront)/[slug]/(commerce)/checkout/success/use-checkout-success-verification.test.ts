import { CHECKOUT_FUNNEL_EVENTS } from '@baci/shared/contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { useRouter } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKOUT_PENDING_ORDER_STORAGE_KEY } from '@/components/storefront/ogabassey/pages/checkout/pending-checkout-order';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import { useCheckoutSuccessVerification } from './use-checkout-success-verification';
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

const mockVerify = vi.mocked(verifyCheckoutPayment);
const mockHasPendingRedvault = vi.mocked(hasMatchingPendingRedvaultOrder);
const mockCapture = vi.mocked(captureCheckoutFunnelEventOnce);

function setup(overrides = {}) {
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
    ...overrides,
  };
  return { push, clearCart, props };
}

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
        clearCart: props.clearCart,
        setStatus: expect.any(Function),
      })
    );
    expect(mockHasPendingRedvault).toHaveBeenCalledWith('order-1');
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

  it('re-polls while pending and stops once terminal', async () => {
    vi.useFakeTimers();
    mockVerify.mockResolvedValue(undefined);
    const { props } = setup();

    renderHook(() => useCheckoutSuccessVerification(props));

    await act(async () => {});
    expect(mockVerify).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await act(async () => {});
    expect(mockVerify).toHaveBeenCalledTimes(2);

    // Terminal success arms no further passes.
    const handlers = mockVerify.mock.calls[1][1];
    await act(async () => {
      handlers.setStatus('success');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mockVerify).toHaveBeenCalledTimes(2);
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

  it('resets terminal state when navigation changes the identity', async () => {
    // First identity confirms; the second stays pending so the reset is
    // observable.
    mockVerify.mockImplementationOnce(async (_params, handlers) => {
      handlers.setStatus('success');
      handlers.setOrderNumber('BAC-1');
    });
    mockVerify.mockResolvedValue(undefined);
    const { props } = setup();

    const { result, rerender } = renderHook(
      ({ orderId }: { orderId: string }) =>
        useCheckoutSuccessVerification({ ...props, orderId }),
      { initialProps: { orderId: 'order-1' } }
    );

    await waitFor(() => expect(result.current.status).toBe('success'));

    rerender({ orderId: 'order-2' });

    await waitFor(() => expect(result.current.status).toBe('pending'));
    expect(result.current.orderNumber).toBeNull();
    expect(mockVerify).toHaveBeenCalledTimes(2);
  });
});
