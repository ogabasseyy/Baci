import { renderHook } from '@testing-library/react';
import type { useRouter } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureBnplPaymentCompleted } from '../capture-bnpl-payment-completed';
import { clearCheckoutIdempotencyKey } from '../checkout-idempotency';
import { clearCreditDirectPopupMarker } from '../credit-direct-popup-return';
import { CHECKOUT_PENDING_ORDER_STORAGE_KEY } from '../pending-checkout-order';
import { useCreditDirectConfirmationRedirect } from './use-credit-direct-confirmation-redirect';

vi.mock('../capture-bnpl-payment-completed', () => ({
  captureBnplPaymentCompleted: vi.fn(),
}));

vi.mock('../checkout-idempotency', () => ({
  clearCheckoutIdempotencyKey: vi.fn(),
}));

vi.mock('../credit-direct-popup-return', () => ({
  clearCreditDirectPopupMarker: vi.fn(),
}));

function router() {
  return { push: vi.fn() } as unknown as ReturnType<typeof useRouter>;
}

function options(overrides = {}) {
  return {
    phase: 'confirmed' as const,
    marker: {
      source: 'popup' as const,
      transactionId: 'txn-1',
      storedAt: '2026-09-21T00:00:00.000Z',
    },
    orderId: 'order-1',
    trackingToken: 'track-1',
    lookupEmail: null,
    orderSuccessBasePath: '/test-store/order-success',
    router: router(),
    ...overrides,
  };
}

describe('useCreditDirectConfirmationRedirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('captures, cleans up, and navigates on confirmation', () => {
    const push = vi.fn();
    const clearCart = vi.fn();
    window.sessionStorage.setItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY, '{}');
    window.sessionStorage.setItem('checkout-form', '{}');

    renderHook(() =>
      useCreditDirectConfirmationRedirect(
        options({
          router: { push } as unknown as ReturnType<typeof useRouter>,
          clearCart,
          confirmedTotal: 21500,
          confirmedCurrency: 'NGN',
        })
      )
    );

    expect(captureBnplPaymentCompleted).toHaveBeenCalledWith({
      orderId: 'order-1',
      paymentMethod: 'credit_direct',
      reference: 'txn-1',
      value: 21500,
      currency: 'NGN',
    });
    expect(clearCart).toHaveBeenCalledTimes(1);
    expect(
      window.sessionStorage.getItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY)
    ).toBeNull();
    expect(window.sessionStorage.getItem('checkout-form')).toBeNull();
    expect(clearCheckoutIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(clearCreditDirectPopupMarker).toHaveBeenCalledWith('order-1');
    expect(push).toHaveBeenCalledWith(
      '/test-store/order-success?orderId=order-1&reference=txn-1&type=credit_direct&trackingToken=track-1'
    );
  });

  it('passes the lookup email when no tracking token exists', () => {
    const push = vi.fn();

    renderHook(() =>
      useCreditDirectConfirmationRedirect(
        options({
          router: { push } as unknown as ReturnType<typeof useRouter>,
          trackingToken: null,
          lookupEmail: 'guest@example.com',
        })
      )
    );

    expect(push).toHaveBeenCalledWith(
      '/test-store/order-success?orderId=order-1&reference=txn-1&type=credit_direct&email=guest%40example.com'
    );
  });

  it('does nothing before the confirmed phase', () => {
    const push = vi.fn();

    renderHook(() =>
      useCreditDirectConfirmationRedirect(
        options({
          phase: 'verifying',
          router: { push } as unknown as ReturnType<typeof useRouter>,
        })
      )
    );

    expect(captureBnplPaymentCompleted).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('runs the cleanup exactly once per order and transaction', () => {
    const push = vi.fn();
    const { rerender } = renderHook(
      ({ phase }: { phase: 'verifying' | 'confirmed' }) =>
        useCreditDirectConfirmationRedirect(
          options({
            phase,
            router: { push } as unknown as ReturnType<typeof useRouter>,
          })
        ),
      { initialProps: { phase: 'confirmed' as const } }
    );

    rerender({ phase: 'confirmed' });

    expect(captureBnplPaymentCompleted).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
  });
});
