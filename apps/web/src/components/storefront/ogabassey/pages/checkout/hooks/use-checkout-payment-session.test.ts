import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscountResult } from '@/components/storefront/checkout/discount-code-input';
import { useCheckoutPaymentSession } from './use-checkout-payment-session';

function options(overrides: Record<string, unknown> = {}) {
  return {
    baseTotal: 11_500,
    clearPendingCheckoutOrder: vi.fn(),
    currencyCode: 'NGN',
    discountSubtotal: 10_000,
    hasAuthenticatedUser: false,
    isOrderInFlightRef: { current: false },
    merchantSlug: undefined,
    pendingCheckoutOrder: null,
    walletSessionIdentity: null,
    resumeOrder: {
      resumeOrderId: null,
      resumeMerchantSlug: null,
      resumeTrackingToken: null,
      resumeLookupEmail: null,
      preferredGateway: null,
      setIsLoadingResumedOrder: vi.fn(),
      setResumedOrder: vi.fn(),
      setCheckoutFields: vi.fn(),
      setResumeOrderError: vi.fn(),
    },
    ...overrides,
  };
}

describe('useCheckoutPaymentSession', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));

  it('preserves a persisted Redvault fence when switching away from Redvault', () => {
    const clearPendingCheckoutOrder = vi.fn();
    const input = options({
      clearPendingCheckoutOrder,
      pendingCheckoutOrder: { paymentMethod: 'uba_redvault' },
    });
    const { result } = renderHook(() => useCheckoutPaymentSession(input as never));

    act(() => {
      result.current.selectMethod('uba_redvault');
      result.current.redvault.setSummary({} as never);
      result.current.redvault.setStatus('error');
      result.current.redvault.setOrderReady({} as never);
    });
    act(() => result.current.selectMethod('paystack'));

    expect(clearPendingCheckoutOrder).not.toHaveBeenCalled();
    expect(result.current.redvault.summary).toBeNull();
    expect(result.current.redvault.status).toBe('idle');
    expect(result.current.redvault.orderReady).toBeNull();
    expect(result.current.method).toBe('paystack');
  });

  it('blocks payment switching while an order is in flight before clearing fences', () => {
    const clearPendingCheckoutOrder = vi.fn();
    const input = options({
      clearPendingCheckoutOrder,
      isOrderInFlightRef: { current: true },
      pendingCheckoutOrder: { paymentMethod: 'paystack' },
    });
    const { result } = renderHook(() => useCheckoutPaymentSession(input as never));

    act(() => result.current.selectMethod('uba_redvault'));

    expect(result.current.method).toBe('');
    expect(clearPendingCheckoutOrder).not.toHaveBeenCalled();
  });

  it.each(['pending', 'held'] as const)(
    'blocks payment switching while Redvault is %s',
    (status) => {
      const clearPendingCheckoutOrder = vi.fn();
      const { result } = renderHook(() =>
        useCheckoutPaymentSession(
          options({ clearPendingCheckoutOrder }) as never
        )
      );

      act(() => {
        result.current.selectMethod('uba_redvault');
        result.current.redvault.setStatus(status);
      });
      clearPendingCheckoutOrder.mockClear();
      act(() => result.current.selectMethod('paystack'));

      expect(result.current.method).toBe('uba_redvault');
      expect(clearPendingCheckoutOrder).not.toHaveBeenCalled();
    }
  );

  it('clears a non-Redvault pending fence before entering Redvault', () => {
    const clearPendingCheckoutOrder = vi.fn();
    const { result } = renderHook(() =>
      useCheckoutPaymentSession(
        options({
          clearPendingCheckoutOrder,
          pendingCheckoutOrder: { paymentMethod: 'paystack' },
        }) as never
      )
    );

    act(() => result.current.selectMethod('uba_redvault'));

    expect(clearPendingCheckoutOrder).toHaveBeenCalledTimes(1);
    expect(result.current.method).toBe('uba_redvault');
  });

  it('auto-applies a positive wallet balance and ignores an aborted stale response', async () => {
    const requests: Array<(response: Response) => void> = [];
    const signals: AbortSignal[] = [];
    vi.mocked(fetch).mockImplementation(((_url, init) => {
      signals.push(init?.signal as AbortSignal);
      return new Promise<Response>((resolve) => requests.push(resolve));
    }) as typeof fetch);
    const { result, rerender } = renderHook(
      ({ merchantSlug }: { merchantSlug: string }) =>
        useCheckoutPaymentSession(
          options({
            hasAuthenticatedUser: true,
            merchantSlug,
          }) as never
        ),
      { initialProps: { merchantSlug: 'old-store' } }
    );
    await waitFor(() => expect(requests).toHaveLength(1));

    rerender({ merchantSlug: 'new-store' });
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(signals[0]?.aborted).toBe(true);

    await act(async () => {
      requests[1]?.({
        ok: true,
        json: async () => ({ balance: 2500 }),
      } as Response);
    });
    await waitFor(() => {
      expect(result.current.wallet.balance).toBe(2500);
      expect(result.current.wallet.payWithWallet).toBe(true);
      expect(result.current.wallet.loading).toBe(false);
    });

    await act(async () => {
      requests[0]?.({
        ok: true,
        json: async () => ({ balance: 100 }),
      } as Response);
    });
    expect(result.current.wallet.balance).toBe(2500);
    expect(result.current.wallet.payWithWallet).toBe(true);
  });

  it('uses the existing discount rounding and caps wallet credit to NGN order total', () => {
    const { result } = renderHook(() =>
      useCheckoutPaymentSession(options() as never)
    );
    const discount: DiscountResult = {
      valid: true,
      code: 'SAVE10',
      discount_type: 'percentage',
      discount_value: 10,
    };

    act(() => {
      result.current.discount.setApplied(discount);
      result.current.wallet.setBalance(20_000);
      result.current.wallet.setPayWithWallet(true);
      result.current.selectMethod('paystack');
    });

    expect(result.current.checkoutValues.discountAmount).toBe(1000);
    expect(result.current.total).toBe(10_500);
    expect(result.current.wallet.amountUsed).toBe(10_500);
    expect(result.current.wallet.remainingAmount).toBe(0);
  });

  it('keeps wallet credit disabled for non-NGN while preserving discount math', () => {
    const { result } = renderHook(() =>
      useCheckoutPaymentSession(
        options({ currencyCode: 'USD' }) as never
      )
    );
    act(() => {
      result.current.discount.setApplied({
        valid: true,
        code: 'SAVE',
        discount_type: 'fixed',
        discount_value: 800,
      });
      result.current.wallet.setBalance(5000);
      result.current.wallet.setPayWithWallet(true);
      result.current.selectMethod('paystack');
    });

    expect(result.current.total).toBe(10_700);
    expect(result.current.wallet.amountUsed).toBe(0);
    expect(result.current.checkoutValues.useWalletCredit).toBe(false);
  });

  it('excludes discount and wallet credit from Redvault order values', () => {
    const { result } = renderHook(() =>
      useCheckoutPaymentSession(options() as never)
    );
    act(() => {
      result.current.discount.setApplied({
        valid: true,
        code: 'SAVE',
        discount_type: 'fixed',
        discount_value: 800,
      });
      result.current.wallet.setBalance(5000);
      result.current.wallet.setPayWithWallet(true);
      result.current.selectMethod('uba_redvault');
    });

    expect(result.current.total).toBe(11_500);
    expect(result.current.checkoutValues.discountCode).toBeNull();
    expect(result.current.wallet.amountUsed).toBe(0);
  });
});
