// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockHasPendingRedvault,
  mockVerify,
  setup,
  useCheckoutSuccessVerification,
} from './use-checkout-success-verification.test-support';
import {
  VERIFY_REPOLL_MAX_ATTEMPTS,
  VERIFY_REPOLL_SLOW_INTERVAL_MS,
} from './verification-timing';
import type { VerifyCheckoutPaymentHandlers } from './verify-checkout-payment';

describe('checkout verification polling and identity', () => {
  beforeEach(() => {
    mockHasPendingRedvault.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('does not arm a polling timer after the first verification settles', async () => {
    vi.useFakeTimers();
    mockVerify.mockImplementationOnce(async (_params, handlers) => {
      handlers.setStatus('reversed');
    });
    const { props } = setup();
    const { result } = renderHook(() => useCheckoutSuccessVerification(props));

    await act(async () => {});
    expect(result.current.status).toBe('reversed');
    expect(vi.getTimerCount()).toBe(0);
    expect(mockVerify).toHaveBeenCalledTimes(1);
  });

  it('clears the prior order number when the storefront changes', async () => {
    let previousHandlers: VerifyCheckoutPaymentHandlers | undefined;
    mockVerify
      .mockImplementationOnce(async (_params, handlers) => {
        previousHandlers = handlers;
        handlers.setOrderNumber('BAC-1');
        handlers.setStatus('pending');
      })
      .mockImplementationOnce(async (_params, handlers) => {
        handlers.setStatus('verification_unavailable');
      });
    const { props } = setup();
    const { result, rerender } = renderHook(
      (hookProps) => useCheckoutSuccessVerification(hookProps),
      { initialProps: props }
    );
    await waitFor(() => expect(result.current.orderNumber).toBe('BAC-1'));

    rerender({ ...props, merchantSlug: 'another-store' });

    await waitFor(() =>
      expect(result.current.status).toBe('verification_unavailable')
    );
    expect(result.current.orderNumber).toBeNull();
    act(() => previousHandlers?.setOrderNumber('BAC-1'));
    expect(result.current.orderNumber).toBeNull();
  });

  it('waits for the rate-limit delay before polling again', async () => {
    vi.useFakeTimers();
    mockVerify
      .mockImplementationOnce(async (_params, handlers) => {
        handlers.setStatus('pending', 30_000);
      })
      .mockResolvedValue(undefined);
    const { props } = setup();
    renderHook(() => useCheckoutSuccessVerification(props));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_999);
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mockVerify).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mockVerify).toHaveBeenCalledTimes(2);
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

    const previous = mockVerify.mock.calls[0][1];
    rerender({ orderId: 'order-2' });
    act(() => {
      previous.clearCart();
      previous.setIsVerifying(true);
      previous.setPaymentMethod('bank_card_offer');
      previous.setOrderNumber('BAC-1');
    });
    expect(result.current.paymentMethod).toBeNull();
    expect(result.current.isVerifying).toBe(false);
    expect(props.clearCart).not.toHaveBeenCalled();

    await waitFor(() => expect(result.current.status).toBe('pending'));
    expect(result.current.orderNumber).toBeNull();
    expect(mockVerify).toHaveBeenCalledTimes(2);
  });

  it.each([
    `BCO-${'a'.repeat(32)}`,
    'standard-reference',
  ])('offers safe refresh guidance after polling is exhausted (%s)', async (reference) => {
    vi.useFakeTimers();
    mockVerify.mockResolvedValue(undefined);
    const { props } = setup();
    const { result } = renderHook(() =>
      useCheckoutSuccessVerification({
        ...props,
        reference,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        VERIFY_REPOLL_MAX_ATTEMPTS * VERIFY_REPOLL_SLOW_INTERVAL_MS
      );
    });
    expect(mockVerify).toHaveBeenCalledTimes(VERIFY_REPOLL_MAX_ATTEMPTS);
    expect(result.current.status).toBe('verification_unavailable');
    expect(props.clearCart).not.toHaveBeenCalled();
  });
});
