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
    hasCheckoutCartItems: false,
    isOrderInFlightRef: { current: false },
    merchantSlug: undefined,
    pendingCheckoutOrder: null,
    walletSessionUserId: undefined,
    resumeOrderId: null as string | null,
    preferredGateway: null as 'credpal' | 'credit_direct' | null,
    resumedOrder: null as { id: string } | null,
    ...overrides,
  };
}

describe('useCheckoutPaymentSession', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));

  it('selects a resumed BNPL gateway only after order lookup succeeds', async () => {
    const input = options({
      resumeOrderId: 'resumed-order',
      preferredGateway: 'credit_direct',
    });
    const { result, rerender } = renderHook(
      ({ currentOptions }: { currentOptions: ReturnType<typeof options> }) =>
        useCheckoutPaymentSession(currentOptions as never),
      { initialProps: { currentOptions: input } }
    );

    expect(result.current.method).toBe('');
    expect(result.current.tab).toBe('full');
    rerender({
      currentOptions: {
        ...input,
        resumedOrder: { id: 'resumed-order' },
      },
    });

    await waitFor(() => expect(result.current.method).toBe('credit_direct'));
    expect(result.current.tab).toBe('installments');
    act(() => result.current.selectMethod('paystack'));
    expect(result.current.method).toBe('paystack');
  });

  it('preserves a persisted Redvault fence when switching away from Redvault', () => {
    const clearPendingCheckoutOrder = vi.fn();
    const input = options({
      clearPendingCheckoutOrder,
      pendingCheckoutOrder: { paymentMethod: 'uba_redvault' },
    });
    const { result } = renderHook(() =>
      useCheckoutPaymentSession(input as never)
    );

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
    const { result } = renderHook(() =>
      useCheckoutPaymentSession(input as never)
    );

    act(() => result.current.selectMethod('uba_redvault'));

    expect(result.current.method).toBe('');
    expect(clearPendingCheckoutOrder).not.toHaveBeenCalled();
  });

  it.each([
    'pending',
    'held',
  ] as const)('blocks payment switching while Redvault is %s', (status) => {
    const clearPendingCheckoutOrder = vi.fn();
    const { result } = renderHook(() =>
      useCheckoutPaymentSession(options({ clearPendingCheckoutOrder }) as never)
    );

    act(() => {
      result.current.selectMethod('uba_redvault');
      result.current.redvault.setStatus(status);
    });
    clearPendingCheckoutOrder.mockClear();
    act(() => result.current.selectMethod('paystack'));

    expect(result.current.method).toBe('uba_redvault');
    expect(clearPendingCheckoutOrder).not.toHaveBeenCalled();
  });

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
            walletSessionUserId: 'customer-1',
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

  it.each([
    'credpal',
    'credit_direct',
  ] as const)('does not apply wallet credit to an authenticated resumed %s payment', async (preferredGateway) => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).includes('/customer/wallet')) {
        return {
          ok: true,
          json: async () => ({ balance: 2500 }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          id: 'resumed-order',
          total: 11_500,
          customer_name: 'Ada Customer',
          customer_email: 'ada@example.test',
          customer_phone: '+2348000000000',
          items: [],
        }),
      } as Response;
    });
    const input = options({
      baseTotal: 11_500,
      hasAuthenticatedUser: true,
      walletSessionUserId: 'customer-1',
      merchantSlug: 'store',
      resumeOrderId: 'resumed-order',
      preferredGateway,
      resumedOrder: { id: 'resumed-order' },
    });
    const { result } = renderHook(() =>
      useCheckoutPaymentSession(input as never)
    );

    await waitFor(() => expect(result.current.wallet.balance).toBe(2500));
    await waitFor(() => expect(result.current.method).toBe(preferredGateway));
    expect(result.current.tab).toBe('installments');

    expect(result.current.wallet.payWithWallet).toBe(false);
    expect(result.current.wallet.amountUsed).toBe(0);
    expect(result.current.wallet.remainingAmount).toBe(11_500);
    expect(result.current.checkoutValues.payWithWallet).toBe(false);

    act(() => {
      result.current.selectMethod('paystack');
      result.current.selectMethod(preferredGateway);
    });

    expect(result.current.wallet.amountUsed).toBe(0);
    expect(result.current.wallet.remainingAmount).toBe(11_500);
  });

  it('keeps wallet credit available when an active cart takes precedence over a resume ID', () => {
    const input = options({
      baseTotal: 11_500,
      hasCheckoutCartItems: true,
      resumeOrderId: 'resumed-order',
    });
    const { result } = renderHook(() =>
      useCheckoutPaymentSession(input as never)
    );

    act(() => {
      result.current.wallet.setBalance(2500);
      result.current.wallet.setPayWithWallet(true);
      result.current.selectMethod('paystack');
    });

    expect(result.current.wallet.payWithWallet).toBe(true);
    expect(result.current.wallet.amountUsed).toBe(2500);
    expect(result.current.wallet.remainingAmount).toBe(9000);
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

  it('does not subtract a local discount from a resumed order total', () => {
    const input = options();
    const { result, rerender } = renderHook(
      ({ currentOptions }: { currentOptions: ReturnType<typeof options> }) =>
        useCheckoutPaymentSession(currentOptions as never),
      { initialProps: { currentOptions: input } }
    );
    act(() => {
      result.current.discount.setApplied({
        valid: true,
        code: 'SAVE',
        discount_type: 'fixed',
        discount_value: 800,
      });
    });
    expect(result.current.total).toBe(10_700);

    rerender({
      currentOptions: {
        ...input,
        baseTotal: 10_700,
        resumeOrderId: 'resumed-order',
      },
    });

    expect(result.current.discount.applied).not.toBeNull();
    expect(result.current.checkoutValues.discountAmount).toBe(0);
    expect(result.current.total).toBe(10_700);
  });

  it('preserves active-cart discount behavior when a resume ID is also present', () => {
    const input = options({
      hasCheckoutCartItems: true,
      resumeOrderId: 'resumed-order',
    });
    const { result } = renderHook(() =>
      useCheckoutPaymentSession(input as never)
    );
    act(() => {
      result.current.discount.setApplied({
        valid: true,
        code: 'SAVE',
        discount_type: 'fixed',
        discount_value: 800,
      });
    });

    expect(result.current.checkoutValues.discountAmount).toBe(800);
    expect(result.current.total).toBe(10_700);
  });

  it('keeps wallet credit disabled for non-NGN while preserving discount math', () => {
    const { result } = renderHook(() =>
      useCheckoutPaymentSession(options({ currencyCode: 'USD' }) as never)
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
